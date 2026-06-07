import { Tutorial } from '../db/models.js';
import { uploadToCloudinary, uploadToCloudinaryStream } from '../utils/cloudinary.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
export const tutorialService = {

  async create(creatorId: string, data: {
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  isFree?: boolean;
  price?: number;
  templateId?: string;
  videoPath?:   string;
  videoBuffer?: Buffer;
  thumbPath?:   string;
  thumbBuffer?: Buffer;
}) {

    if (!data.videoPath) throw new AppError('Video file path missing — disk storage may not be configured', 500);

    type CloudinaryResult = { url: string; publicId: string };
    let video!: CloudinaryResult;
    let thumb: CloudinaryResult | null = null;

    try {
      const results = await Promise.all([
        uploadToCloudinaryStream(data.videoPath, 'tutorials', {
          resource_type: 'video',
          chunk_size:    6_000_000,
          timeout:       660_000,
        }),
        (data.thumbPath || data.thumbBuffer)
          ? uploadToCloudinary(
              data.thumbPath ?? data.thumbBuffer!,
              'tutorial-thumbs',
              { resource_type: 'image' },
            )
          : Promise.resolve(null),
      ]);
      video = results[0] as CloudinaryResult;
      thumb = results[1] as CloudinaryResult | null;
    } catch (err: any) {
      const detail = JSON.stringify(err, Object.getOwnPropertyNames(err));
      logger.error('Cloudinary upload failed', { detail });
      throw new AppError(`Cloudinary upload failed. Please try again. `, 500);
    }

    // Clean up temp files
    {
      const fs = await import('fs/promises');
      if (data.videoPath) await fs.unlink(data.videoPath).catch(() => {});
      if (data.thumbPath)  await fs.unlink(data.thumbPath).catch(() => {});
    }

    // Auto-generate thumbnail from video first frame if no thumb was uploaded.
// Uses Cloudinary's free URL-based transformation — no extra API call or upload credit.
// Pattern: /tutorials/<publicId> → /tutorials/so_0,w_640,h_360,c_fill/<publicId>.jpg
const autoThumbnailUrl = thumb?.url ?? (() => {
  // video.url looks like: https://res.cloudinary.com/<cloud>/video/upload/v123/tutorials/<publicId>.mp4
  // We rewrite it to the image delivery URL with a frame grab at second 0.
  return video.url
    .replace('/video/upload/', '/video/upload/so_0,w_640,h_360,c_fill,q_auto,f_jpg/')
    .replace(/\.(mp4|webm|mov)(\?.*)?$/, '.jpg');
})();

return Tutorial.create({
  creatorId,
  templateId: data.templateId ?? null,
  title: data.title,
  description: data.description,
  category: data.category,
  tags: data.tags || [],
  isFree: data.isFree ?? true,
  price: data.price || 0,
  videoUrl: video.url,
  videoPublicId: video.publicId,
  thumbnailUrl: autoThumbnailUrl,   // always populated 
  status: 'PENDING',
  approvedBy: null,
  approvedAt: null,
  rejectedBy: null,
  rejectedAt: null,
  rejectionReason: null,
});
  },

  async list(query: {
    category?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {

    const filter: Record<string, any> = {};

    // Public users only see APPROVED
    filter.status = query.status ?? 'APPROVED';

    if (query.category) {
      filter.category = query.category;
    }

    const page = query.page || 1;

    const limit = Math.min(
      query.limit || 20,
      50,
    );

    return Tutorial.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
  },

  async getById(id: string, requesterRole?: string) {

    const tutorial = await Tutorial.findById(id).lean();

    if (!tutorial) {
      throw new AppError('Tutorial not found', 404);
    }

    // Non-admins cannot access non-approved tutorials
    if (
      tutorial.status !== 'APPROVED' &&
      requesterRole !== 'ADMIN'
    ) {
      throw new AppError('Tutorial not found', 404);
    }

    return tutorial;
  },

  // ADMIN — PENDING
  async pending() {

    return Tutorial.find({
      status: 'PENDING',
    })
      .sort({ createdAt: -1 })
      .lean();
  },

  // ADMIN — APPROVE
  async approve(id: string, adminId: string) {

    const tutorial = await Tutorial.findByIdAndUpdate(
      id,
      {
        status: 'APPROVED',

        approvedBy: adminId,
        approvedAt: new Date(),

        rejectedBy: null,
        rejectedAt: null,

        rejectionReason: null,
      },
      { new: true },
    );

    if (!tutorial) {
      throw new AppError('Tutorial not found', 404);
    }

    return tutorial;
  },

  // ADMIN — REJECT
  async reject(
    id: string,
    adminId: string,
    reason: string,
  ) {

    const tutorial = await Tutorial.findByIdAndUpdate(
      id,
      {
        status: 'REJECTED',

        rejectedBy: adminId,
        rejectedAt: new Date(),

        rejectionReason: reason,

        approvedBy: null,
        approvedAt: null,
      },
      { new: true },
    );

    if (!tutorial) {
      throw new AppError('Tutorial not found', 404);
    }

    return tutorial;
  },

  async unpublish(id: string, adminId: string, reason: string) {
  const tutorial = await Tutorial.findById(id);
  if (!tutorial) throw new AppError('Tutorial not found', 404);
  if (tutorial.status !== 'APPROVED') {
    throw new AppError('Only approved tutorials can be unpublished', 400);
  }

  const updated = await Tutorial.findByIdAndUpdate(
    id,
    {
      status: 'PENDING',          // back to review queue
      rejectedBy: adminId,
      rejectedAt: new Date(),
      rejectionReason: reason,
      approvedBy: null,
      approvedAt: null,
    },
    { new: true }
  );

  return updated;
},

  // ── ADD START ──
async listByStatus(status: 'PENDING' | 'APPROVED' | 'REJECTED') {
  return Tutorial.find({ status })
    .sort({ createdAt: -1 })
    .lean();
},

async permanentDelete(id: string) {
  const tutorial = await Tutorial.findById(id);
  if (!tutorial) throw new AppError('Tutorial not found', 404);

  // Safety — only wipe REJECTED tutorials permanently
  if (tutorial.status !== 'REJECTED') {
    throw new AppError(
      'Tutorial must be rejected before it can be permanently deleted.',
      403
    );
  }

  // Delete from Cloudinary
  const { deleteFromCloudinary } = await import('../utils/cloudinary.js');
  await Promise.allSettled([
    tutorial.videoPublicId
      ? deleteFromCloudinary(tutorial.videoPublicId, 'video')
      : Promise.resolve(),
    tutorial.thumbnailUrl
      ? deleteFromCloudinary(
          tutorial.thumbnailUrl.split('/').pop()!.split('.')[0],
          'image'
        )
      : Promise.resolve(),
  ]);

  await Tutorial.findByIdAndDelete(id);
},
};