import { Template } from '../models/template.model.js';
import { uploadToCloudinary, deleteFromCloudinary, uploadToCloudinaryStream } from '../utils/cloudinary.js';
import { paymentService } from './payment.service.js';
import { AppError } from '../middleware/errorHandler.js';
import prisma from '../db/prisma.js';
import logger from '../utils/logger.js';


// ─── Size limits (free-tier safe) ─────────────────────────────────────────────
const MAX_VIDEO_BYTES =  70 * 1024 * 1024;   //  70 MB
const MAX_IMAGE_BYTES =   5 * 1024 * 1024;   //   5 MB
const MAX_PDF_BYTES   =  10 * 1024 * 1024;   //  10 MB
// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveFileType(mime: string): 'video' | 'zip' | 'image' | 'pdf' {
  if (mime.startsWith('video/'))                                    return 'video';
  if (mime.startsWith('image/'))                                    return 'image';
  if (mime === 'application/pdf')                                   return 'pdf';
  throw new AppError('Unsupported file type', 400);
}

function checkSize(fileType: ReturnType<typeof resolveFileType>, bytes: number) {
  const limits: Record<string, number> = {
    video: MAX_VIDEO_BYTES,
    image: MAX_IMAGE_BYTES,
    pdf:   MAX_PDF_BYTES,
  };
  if (bytes > limits[fileType]) {
    const mb = Math.round(limits[fileType] / 1024 / 1024);
    throw new AppError(`File too large. Max ${mb} MB for ${fileType} files.`, 413);
  }
}

// ─── Cloudinary upload per type ───────────────────────────────────────────────

// ── New uploadFile signature: accepts path (video/zip) or buffer (image/pdf) ──
async function uploadFile(
  source: Buffer | string,
  fileType: ReturnType<typeof resolveFileType>,
): Promise<{
  fileUrl:         string;
  filePublicId:    string;
  previewUrl:      string | null;
  previewVideoUrl: string | null;
  previewPublicId: string | null;
}> {

  if (fileType === 'video') {
    if (typeof source !== 'string') throw new Error('Video upload requires a file path');
    const result = await uploadToCloudinaryStream(source, 'templates/videos', {
      resource_type: 'video',
      chunk_size:    6_000_000,   // 6 MB chunks — Cloudinary resumable threshold
      timeout:       600_000,     // 10 min — enough for a 200 MB video on free tier
    });

    const previewUrl = result.url
      .replace('/upload/', '/upload/so_0,w_640,f_jpg,q_auto/')
      .replace(/\.[^.]+$/, '.jpg');

    const previewVideoUrl = result.url
      .replace('/upload/', '/upload/so_0,eo_8,w_640,q_auto/');

    return { fileUrl: result.url, filePublicId: result.publicId, previewUrl, previewVideoUrl, previewPublicId: null };
  }

  if (fileType === 'image') {
    // Images still come as buffers (multer memoryStorage for images)
    const result = await uploadToCloudinary(source, 'templates/images', { resource_type: 'image' });
    return { fileUrl: result.url, filePublicId: result.publicId, previewUrl: result.url, previewVideoUrl: null, previewPublicId: result.publicId };
  }

  // PDF
  const result = await uploadToCloudinary(source, 'templates/pdfs', { resource_type: 'raw' });
  return { fileUrl: result.url, filePublicId: result.publicId, previewUrl: null, previewVideoUrl: null, previewPublicId: null };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const templateService = {

async create(creatorId: string, data: {
  title: string; description: string; category: string;
  tags: string[]; software: string[]; price: number; currency: string;
  fileBuffer?: Buffer;   // images (still in memory)
  filePath?:   string;   // video/zip (on disk)
  fileMime: string; fileSizeBytes: number; originalName: string;
}) {
  const fileType = resolveFileType(data.fileMime);
  checkSize(fileType, data.fileSizeBytes);

  const source = data.filePath ?? data.fileBuffer!;

  let uploaded;
  try {
    uploaded = await uploadFile(source, fileType);
  } finally {
    // Always clean up the temp file to avoid filling the disk
    if (data.filePath) {
      const fs = await import('fs/promises');
      await fs.unlink(data.filePath).catch(() => {});
    }
  }

  const { fileUrl, filePublicId, previewUrl, previewVideoUrl, previewPublicId } = uploaded;

  const template = await Template.create({
    creatorId, title: data.title, description: data.description,
    category: data.category, tags: data.tags, software: data.software,
    price: data.price, currency: data.currency,
    fileUrl, filePublicId, fileType, fileSizeBytes: data.fileSizeBytes,
    previewUrl, previewVideoUrl: previewVideoUrl ?? null, previewPublicId,
    status: 'PENDING',
  });

  logger.info('Template created', { templateId: template.id, creatorId, fileType });
  return template;
},

  async list(params: {
    category?: string;
    search?: string;
    creatorId?: string;
    status?: string;
    page: number;
    limit: number;
    sort?: string;
  }) {
    const { category, search, creatorId, status, page, limit, sort } = params;

    const safeLimit = Math.min(limit, 50);
    const skip = (page - 1) * safeLimit;

    const filter: Record<string, any> = {};
filter.status = status ?? (creatorId ? { $ne: 'REJECTED' } : 'APPROVED');

    if (category)  filter.category  = category;
    if (creatorId) filter.creatorId = creatorId;
    if (search)    filter.$text = { $search: search };

    const sortMap: Record<string, any> = {
      newest:     { createdAt: -1 },
      oldest:     { createdAt:  1 },
      price_asc:  { price: 1 },
      price_desc: { price: -1 },
      popular:    { purchaseCount: -1 },
    };
    const sortBy = sortMap[sort ?? 'newest'] ?? { createdAt: -1 };

 const [templates, total] = await Promise.all([
  Template.find(filter)
    .sort(sortBy)
    .skip(skip)
    .limit(safeLimit)
    .select('-filePublicId -previewPublicId -fileUrl')
    .lean(),
  Template.countDocuments(filter),
]);

// Enrich with creator names from Postgres
const creatorIds = [...new Set(templates.map((t: any) => t.creatorId).filter(Boolean))];
const creators = creatorIds.length
  ? await prisma.user.findMany({
      where: { id: { in: creatorIds } },
      select: { id: true, name: true, avatarUrl: true },
    })
  : [];
const creatorMap = Object.fromEntries(creators.map(c => [c.id, c]));

const enriched = templates.map((t: any) => ({
  ...t,
  creator: creatorMap[t.creatorId] ?? null,
}));

return {
  templates: enriched,
  pagination: {
    page,
    limit: safeLimit,
    total,
    pages: Math.ceil(total / safeLimit),
  },
};
  },

  async getById(id: string, requesterRole?: string) {
    const template = await Template.findById(id)
      .select('-filePublicId -previewPublicId -fileUrl')
      .lean();
    if (!template) throw new AppError('Template not found', 404);
    if (template.status !== 'APPROVED' && requesterRole !== 'ADMIN') {
      throw new AppError('Template not found', 404);
    }
    return template;
  },

  async getDownloadUrl(templateId: string, buyerId: string) {
    const template = await Template.findById(templateId);
    if (!template) throw new AppError('Template not found', 404);
    if (template.status !== 'APPROVED') throw new AppError('Template not available', 403);

    if (template.price === 0) {
      await Template.findByIdAndUpdate(templateId, { $inc: { downloadCount: 1 } });
      return template.fileUrl;
    }

    const order = await prisma.order.findFirst({
      where: {
        buyerId,
        mongoTemplateId: templateId,
        status: { in: ['PAID', 'COMPLETED'] },
      },
    });
    if (!order) throw new AppError('Purchase required to download this template', 403);

    await Template.findByIdAndUpdate(templateId, { $inc: { downloadCount: 1 } });
    return template.fileUrl;
  },

  async recordPurchase(templateId: string) {
    await Template.findByIdAndUpdate(templateId, { $inc: { purchaseCount: 1, salesCount: 1 } });
  },

  async update(id: string, requesterId: string, data: Partial<{
    title: string; description: string; category: string;
    tags: string[]; software: string[]; price: number; currency: string;
  }>) {
    const template = await Template.findById(id);
    if (!template) throw new AppError('Template not found', 404);
    if (template.creatorId !== requesterId) throw new AppError('Forbidden', 403);

    Object.assign(template, {
      ...data,
      status:          'PENDING',
      approvedBy:      null,
      approvedAt:      null,
      rejectedBy:      null,
      rejectedAt:      null,
      rejectionReason: null,
    });
    await template.save();
    return template;
  },

  async delete(id: string, requesterId: string, requesterRole: string) {
    const template = await Template.findById(id);
    if (!template) throw new AppError('Template not found', 404);
    if (template.creatorId !== requesterId && requesterRole !== 'ADMIN') {
      throw new AppError('Forbidden', 403);
    }

    const resourceType = template.fileType === 'video' ? 'video'
      : template.fileType === 'image' ? 'image'
      : 'raw';

    await deleteFromCloudinary(template.filePublicId, resourceType).catch(err =>
      logger.warn('Cloudinary delete failed (file)', { error: err.message })
    );

    if (template.previewPublicId && template.fileType === 'video') {
      await deleteFromCloudinary(template.previewPublicId, 'image').catch(err =>
        logger.warn('Cloudinary delete failed (preview)', { error: err.message })
      );
    }

    await template.deleteOne();
    logger.info('Template deleted', { id, requesterId });
  },

  async approve(id: string, adminId: string) {
    const template = await Template.findByIdAndUpdate(
      id,
      {
        status:          'APPROVED',
        approvedBy:      adminId,
        approvedAt:      new Date(),
        rejectedBy:      null,
        rejectedAt:      null,
        rejectionReason: null,
      },
      { new: true }
    );
    if (!template) throw new AppError('Template not found', 404);
await prisma.notification.create({
  data: {
    userId:     template.creatorId,
    type:       'TEMPLATE_APPROVED',
    title:      'Template Approved',
    message:    `Your template "${template.title}" has been approved and is now live on the marketplace.`,
    templateId: String(template._id),
  },
});
logger.info('Template approved', { templateId: id, approvedBy: adminId });
return template;
  },

  async reject(id: string, reason: string, adminId: string) {
    const template = await Template.findByIdAndUpdate(
      id,
      {
        status:          'REJECTED',
        rejectedBy:      adminId,
        rejectedAt:      new Date(),
        rejectionReason: reason,
      },
      { new: true }
    );
    if (!template) throw new AppError('Template not found', 404);
await prisma.notification.create({
  data: {
    userId:  template.creatorId,
    type:    'TEMPLATE_REJECTED',
    title:   'Template Rejected',
    message: `Your template "${template.title}" was rejected. Reason: ${reason}`,
  },
});
logger.info('Template rejected', { templateId: id, rejectedBy: adminId, reason });
return template;
  },

  async unpublish(id: string, reason: string, adminId: string) {
    const template = await Template.findById(id);
    if (!template) throw new AppError('Template not found', 404);
    if (template.status !== 'APPROVED') {
      throw new AppError('Only approved templates can be unpublished', 400);
    }

    const updated = await Template.findByIdAndUpdate(
      id,
      {
        status:          'PENDING',
        rejectedBy:      adminId,
        rejectedAt:      new Date(),
        rejectionReason: reason,
        approvedBy:      null,
        approvedAt:      null,
      },
      { new: true }
    );

    await prisma.notification.create({
  data: {
    userId:  template.creatorId,
    type:    'TEMPLATE_UNPUBLISHED',
    title:   'Template Unpublished',
    message: `Your template "${template.title}" was unpublished. Reason: ${reason}`,
  },
});
logger.info('Template unpublished → PENDING', { templateId: id, unpublishedBy: adminId, reason });
return updated;
  },

  async permanentlyDeleteRejected(id: string, adminId: string) {
    const template = await Template.findById(id);
    if (!template) throw new AppError('Template not found', 404);

    if (template.status !== 'REJECTED') {
      throw new AppError(
        'Template must be rejected before it can be permanently deleted. Unpublish → Reject first.',
        403
      );
    }

    const resourceType = template.fileType === 'video' ? 'video'
      : template.fileType === 'image' ? 'image'
      : 'raw';

    try {
      await deleteFromCloudinary(template.filePublicId, resourceType);
      logger.info('Deleted Cloudinary template asset', { templateId: id, publicId: template.filePublicId });
    } catch (err: any) {
      logger.warn('Failed deleting template asset', { templateId: id, error: err.message });
    }

    if (template.previewPublicId && template.previewPublicId !== template.filePublicId) {
      try {
        await deleteFromCloudinary(template.previewPublicId, 'image');
        logger.info('Deleted Cloudinary preview asset', { templateId: id, previewPublicId: template.previewPublicId });
      } catch (err: any) {
        logger.warn('Failed deleting preview asset', { templateId: id, error: err.message });
      }
    }

    await template.deleteOne();
    logger.info('Rejected template permanently deleted', { templateId: id, deletedBy: adminId });
    return true;
  },

  async purchase(templateId: string, buyer: { id: string; email: string }, callbackUrl: string) {
    const template = await Template.findById(templateId);
    if (!template) throw new AppError('Template not found', 404);
    if (template.status !== 'APPROVED') throw new AppError('Template not available', 403);
    if (template.price === 0) throw new AppError('Use download endpoint for free templates', 400);

    const existing = await prisma.order.findFirst({
      where: {
        buyerId: buyer.id,
        mongoTemplateId: templateId,
        status: { in: ['PAID', 'COMPLETED'] },
      },
    });
    if (existing) throw new AppError('You have already purchased this template', 409);

    await prisma.order.updateMany({
      where: {
        buyerId: buyer.id,
        mongoTemplateId: templateId,
        status: 'PENDING',
      },
      data: { status: 'CANCELLED' },
    });

    const effectiveCurrency = template.currency ?? 'USD';

    return paymentService.initializeCheckout(buyer.id, {
      type:        'TEMPLATE',
      referenceId: templateId,
      creatorId:   template.creatorId,
      amount:      template.price,
      currency:    effectiveCurrency,
      email:       buyer.email,
      callbackUrl,
    });
  },

  async generateDownloadToken(templateId: string, buyerId: string): Promise<string> {
    const template = await Template.findById(templateId).select('+fileUrl');
    if (!template) throw new AppError('Template not found', 404);
    if (template.status !== 'APPROVED') throw new AppError('Template not available', 403);

    if (template.price > 0) {
      const order = await prisma.order.findFirst({
        where: {
          buyerId,
          mongoTemplateId: templateId,
          status: { in: ['PAID', 'COMPLETED'] },
        },
      });
      if (!order) throw new AppError('Purchase required', 403);
    }

    const jwt = await import('jsonwebtoken');
    return jwt.default.sign(
      { templateId, buyerId, type: 'download' },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: '15m' }
    );
  },

  async rateTemplate(templateId: string, buyerId: string, data: {
    orderId: string;
    score: number;
    review?: string;
  }) {
    const template = await Template.findById(templateId);
    if (!template) throw new AppError('Template not found', 404);
    if (template.status !== 'APPROVED') throw new AppError('Template not available', 403);

    // Verify the buyer has a completed/paid order for this template
    const order = await prisma.order.findFirst({
      where: {
        id:              data.orderId,
        buyerId,
        mongoTemplateId: templateId,
        status:          { in: ['PAID', 'COMPLETED'] },
      },
    });
    if (!order) throw new AppError('You must purchase this template before rating it', 403);

    // Prevent duplicate ratings
    const existing = await prisma.templateRating.findUnique({
      where: { orderId: data.orderId },
    });
    if (existing) throw new AppError('You have already rated this template', 409);

    // Also block if they already rated this template via any order
    const alreadyRated = await prisma.templateRating.findUnique({
      where: { raterId_mongoTemplateId: { raterId: buyerId, mongoTemplateId: templateId } },
    });
    if (alreadyRated) throw new AppError('You have already rated this template', 409);

    await prisma.templateRating.create({
      data: {
        raterId:         buyerId,
        mongoTemplateId: templateId,
        orderId:         data.orderId,
        score:           data.score,
        review:          data.review,
      },
    });

    // Recompute average and update MongoDB
    const allRatings = await prisma.templateRating.findMany({
      where: { mongoTemplateId: templateId },
      select: { score: true },
    });
    const avg = allRatings.reduce((s, r) => s + r.score, 0) / allRatings.length;

    await Template.findByIdAndUpdate(templateId, {
      rating:      +avg.toFixed(2),
      ratingCount: allRatings.length,
    });

    return { rating: +avg.toFixed(2), ratingCount: allRatings.length };
  },

  async getTemplateRatings(templateId: string) {
    const ratings = await prisma.templateRating.findMany({
      where: { mongoTemplateId: templateId },
      include: { rater: { select: { name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return ratings;
  },

  async downloadWithToken(token: string): Promise<string> {
    const jwt = await import('jsonwebtoken');
    let payload: any;
    try {
      payload = jwt.default.verify(token, process.env.JWT_ACCESS_SECRET!);
    } catch {
      throw new AppError('Invalid or expired download link', 403);
    }

    if (payload.type !== 'download') throw new AppError('Forbidden', 403);

    const template = await Template.findById(payload.templateId).select('+fileUrl');
    if (!template || template.status !== 'APPROVED') {
      throw new AppError('Template not available', 403);
    }

    if (template.price > 0) {
      const order = await prisma.order.findFirst({
        where: {
          buyerId:         payload.buyerId,
          mongoTemplateId: payload.templateId,
          status:          { in: ['PAID', 'COMPLETED'] },
        },
      });
      if (!order) throw new AppError('Purchase required', 403);
    }

    await Template.findByIdAndUpdate(payload.templateId, { $inc: { downloadCount: 1 } });
    return template.fileUrl;
  },
};