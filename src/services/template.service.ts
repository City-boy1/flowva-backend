import { Template } from '../models/template.model.js';
import { uploadToCloudinary, deleteFromCloudinary, uploadToCloudinaryStream } from '../utils/cloudinary.js';
import { paymentService } from './payment.service.js';
import { isPaystackCurrency, isSkrillCurrency, resolveCheckoutProvider } from '../config/payments.config.js';
import { AppError } from '../middleware/errorHandler.js';
import prisma from '../db/prisma.js';
import logger from '../utils/logger.js';


// ─── Size limits (free-tier safe) ─────────────────────────────────────────────
const MAX_VIDEO_BYTES =  70 * 1024 * 1024;   //  70 MB
const MAX_IMAGE_BYTES =   5 * 1024 * 1024;   //   5 MB
const MAX_PDF_BYTES   =  10 * 1024 * 1024;   //  10 MB
const MAX_THUMB_BYTES =   5 * 1024 * 1024;   //   5 MB
const MAX_PREVIEW_VIDEO_BYTES = 70 * 1024 * 1024; // reuse video cap
const MAX_ZIP_BYTES   =  70 * 1024 * 1024;   //  70 MB — see size-limit note below
// ─── Helpers ──────────────────────────────────────────────────────────────────

// Design-tool and archive formats (PSD, AI, BLEND, FBX, mobile-editor
// project files, etc.) rarely report a reliable mimetype from the
// browser — often 'application/octet-stream' or empty — so these are
// resolved by file extension instead, matching every extension the
// dashboard upload wizard's category picker actually offers.
const ZIP_EXTENSIONS = new Set([
  // Motion graphics
  'aep', 'aet', 'mogrt', 'prproj', 'drp', 'fcpxml', 'motion', 'veg', 'hfp',
  // Graphic design
  'psd', 'psb', 'ai', 'eps', 'svg', 'ait', 'indd', 'idml', 'indt', 'cdr', 'cdt',
  'afdesign', 'afphoto', 'afpub', 'sketch', 'fig', 'procreate', 'kra', 'pxd',
  // Animation 2D/3D
  'blend', 'c4d', 'ma', 'mb', 'max', 'moho', 'xsh', 'fla', 'xfl',
  // 3D assets
  'obj', 'fbx', 'glb', 'gltf', 'stl',
  // Mobile
  'plp', 'ibis', 'alm', 'kmproject', 'vnproj',
  // Generic archive fallback
  'zip', 'rar', '7z',
]);

function resolveFileType(mime: string, originalName: string): 'video' | 'zip' | 'image' | 'pdf' {
  if (mime.startsWith('video/'))  return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';

  const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
  if (ZIP_EXTENSIONS.has(ext)) return 'zip';

  throw new AppError(`Unsupported file type: .${ext || 'unknown'}`, 400);
}

function checkSize(fileType: ReturnType<typeof resolveFileType>, bytes: number) {
  const limits: Record<string, number> = {
    video: MAX_VIDEO_BYTES,
    image: MAX_IMAGE_BYTES,
    pdf:   MAX_PDF_BYTES,
    zip:   MAX_ZIP_BYTES,
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
): Promise<{ fileUrl: string; filePublicId: string }> {

  if (fileType === 'video') {
    if (typeof source !== 'string') throw new Error('Video upload requires a file path');
    const result = await uploadToCloudinaryStream(source, 'templates/videos', {
      resource_type: 'video',
      chunk_size:    6_000_000,
      timeout:       600_000,
    });
    return { fileUrl: result.url, filePublicId: result.publicId };
  }

  if (fileType === 'image') {
    const result = await uploadToCloudinary(source, 'templates/images', { resource_type: 'image' });
    return { fileUrl: result.url, filePublicId: result.publicId };
  }

  if (fileType === 'pdf') {
    const result = await uploadToCloudinary(source, 'templates/pdfs', { resource_type: 'raw' });
    return { fileUrl: result.url, filePublicId: result.publicId };
  }

  // zip / design-tool files (PSD, AI, BLEND, FBX, etc.) — Cloudinary
  // stores these as opaque 'raw' assets regardless of the real format.
  const result = typeof source === 'string'
    ? await uploadToCloudinaryStream(source, 'templates/files', { resource_type: 'raw', timeout: 300_000 })
    : await uploadToCloudinary(source, 'templates/files', { resource_type: 'raw' });
  return { fileUrl: result.url, filePublicId: result.publicId };
}

// Thumbnails and preview videos are now always creator-supplied — no
// longer auto-derived from the main template file.
async function uploadThumbnail(source: Buffer | string): Promise<{ url: string; publicId: string }> {
  const result = await uploadToCloudinary(source, 'templates/thumbnails', { resource_type: 'image' });
  return { url: result.url, publicId: result.publicId };
}

async function uploadPreviewVideo(source: Buffer | string): Promise<{ url: string; publicId: string }> {
  const result = typeof source === 'string'
    ? await uploadToCloudinaryStream(source, 'templates/previews', {
        resource_type: 'video', chunk_size: 6_000_000, timeout: 300_000,
      })
    : await uploadToCloudinary(source, 'templates/previews', { resource_type: 'video' });
  return { url: result.url, publicId: result.publicId };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const templateService = {

async create(creatorId: string, data: {
  title: string; description: string; category: string;
  tags: string[]; software: string[];
  priceLocal: number; priceUSD?: number; currency: string;
  fileBuffer?: Buffer;   filePath?: string;
  fileMime: string; fileSizeBytes: number; originalName: string;
  thumbnailBuffer?: Buffer; thumbnailPath?: string;
  thumbnailMime: string; thumbnailSizeBytes: number;
  previewVideoBuffer?: Buffer; previewVideoPath?: string;
  previewVideoMime?: string; previewVideoSizeBytes?: number;
}) {
  const fileType = resolveFileType(data.fileMime, data.originalName);
  checkSize(fileType, data.fileSizeBytes);

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(data.thumbnailMime)) {
    throw new AppError('Thumbnail must be JPEG, PNG, or WebP', 400);
  }
  if (data.thumbnailSizeBytes > MAX_THUMB_BYTES) {
    throw new AppError('Thumbnail too large. Max 5 MB.', 413);
  }
  if (data.previewVideoMime) {
    if (!data.previewVideoMime.startsWith('video/')) {
      throw new AppError('Preview video must be a video file', 400);
    }
    if ((data.previewVideoSizeBytes ?? 0) > MAX_PREVIEW_VIDEO_BYTES) {
      throw new AppError('Preview video too large. Max 70 MB.', 413);
    }
  }

  // Country is always resolved server-side from the creator's own
  // profile — never trusted from the client — since it determines which
  // buyers see this template in local-currency (home) pricing.
  const creator = await prisma.user.findUnique({
    where: { id: creatorId },
    select: { country: true },
  });
  if (!creator) throw new AppError('Creator not found', 404);

  // Fraud/payout-safety rule: a creator must have a payout method on file
  // before they can sell anything — otherwise completed sales have nowhere
  // to pay out to. Set once in Dashboard → Payouts; see payoutService.
  const payoutSettings = await prisma.payoutSetting.findUnique({ where: { userId: creatorId } });
  if (!payoutSettings?.primaryMethod) {
    throw new AppError('Please set up a payout method (Dashboard → Payouts) before uploading a template.', 400);
  }

  const source      = data.filePath ?? data.fileBuffer!;
  const thumbSource  = data.thumbnailPath ?? data.thumbnailBuffer!;
  const previewSource = data.previewVideoPath ?? data.previewVideoBuffer;

  let uploadedFile: { fileUrl: string; filePublicId: string };
  let uploadedThumb: { url: string; publicId: string };
  let uploadedPreview: { url: string; publicId: string } | null = null;

  try {
    uploadedFile  = await uploadFile(source, fileType);
    uploadedThumb = await uploadThumbnail(thumbSource);
    if (previewSource) uploadedPreview = await uploadPreviewVideo(previewSource);
  } finally {
    const fs = await import('fs/promises');
    if (data.filePath)         await fs.unlink(data.filePath).catch(() => {});
    if (data.thumbnailPath)    await fs.unlink(data.thumbnailPath).catch(() => {});
    if (data.previewVideoPath) await fs.unlink(data.previewVideoPath).catch(() => {});
  }

  const template = await Template.create({
    creatorId, title: data.title, description: data.description,
    category: data.category, tags: data.tags, software: data.software,
    creatorCountry: creator.country,
    currency:       data.currency,
    priceLocal:     data.priceLocal,
    // priceUSD is meaningless when the creator's own currency is already
    // USD — priceLocal already IS the USD price in that case.
    priceUSD: data.currency === 'USD' ? null : (data.priceUSD ?? null),
    fileUrl:              uploadedFile.fileUrl,
    filePublicId:         uploadedFile.filePublicId,
    fileType, fileSizeBytes: data.fileSizeBytes,
    previewUrl:           uploadedThumb.url,
    previewPublicId:      uploadedThumb.publicId,
    previewVideoUrl:      uploadedPreview?.url ?? null,
    previewVideoPublicId: uploadedPreview?.publicId ?? null,
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
      // NOTE: sorting by priceLocal across mixed currencies isn't
      // apples-to-apples (200 GHS vs 5 USD). The frontend currently does
      // its own sort client-side after filtering to a single
      // country/currency view, so this backend sort option is mostly
      // unused today — left renamed for consistency, not a behavior fix.
      price_asc:  { priceLocal: 1 },
      price_desc: { priceLocal: -1 },
      popular:    { purchaseCount: -1 },
    };
    const sortBy = sortMap[sort ?? 'newest'] ?? { createdAt: -1 };

 const [templates, total] = await Promise.all([
  Template.find(filter)
    .sort(sortBy)
    .skip(skip)
    .limit(safeLimit)
    .select('-filePublicId -previewPublicId -previewVideoPublicId -fileUrl')
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
      .select('-filePublicId -previewPublicId -previewVideoPublicId -fileUrl')
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

    if (template.priceLocal === 0) {
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
    tags: string[]; software: string[];
    priceLocal: number; priceUSD: number; currency: string;
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

    if (template.previewPublicId) {
      await deleteFromCloudinary(template.previewPublicId, 'image').catch(err =>
        logger.warn('Cloudinary delete failed (thumbnail)', { error: err.message })
      );
    }

    if (template.previewVideoPublicId) {
      await deleteFromCloudinary(template.previewVideoPublicId, 'video').catch(err =>
        logger.warn('Cloudinary delete failed (preview video)', { error: err.message })
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

    if (template.previewVideoPublicId) {
      try {
        await deleteFromCloudinary(template.previewVideoPublicId, 'video');
        logger.info('Deleted Cloudinary preview video asset', { templateId: id, previewVideoPublicId: template.previewVideoPublicId });
      } catch (err: any) {
        logger.warn('Failed deleting preview video asset', { templateId: id, error: err.message });
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
    if (template.priceLocal === 0) throw new AppError('Use download endpoint for free templates', 400);

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

    // Mirror the frontend's display-currency decision: buyer in the same
    // country as the creator pays the local price/currency; anyone else
    // pays USD — but only if the creator actually set a USD price (or
    // their own currency already IS USD). The frontend already hides
    // "buy" for USD-less foreign templates, so this is a defensive
    // re-check, not the primary gate.
    const buyerUser = await prisma.user.findUnique({
      where: { id: buyer.id },
      select: { country: true },
    });
    const sameCountry = !!buyerUser?.country && buyerUser.country === template.creatorCountry;

    let amount: number;
    let currency: string;
    if (sameCountry) {
      amount   = template.priceLocal;
      currency = template.currency;
    } else if (template.currency === 'USD') {
      amount   = template.priceLocal;
      currency = 'USD';
    } else if (template.priceUSD != null) {
      amount   = template.priceUSD;
      currency = 'USD';
    } else {
      throw new AppError('This template is not available for purchase outside the creator\'s country', 400);
    }

    // Paystack can only charge a fixed set of currencies. If the resolved
    // currency isn't payable (e.g. a home-country buyer whose own currency
    // isn't Paystack-supported), fall back to the USD price instead of
    // attempting a charge that will fail.
    // ⚠️ The frontend must apply this exact same fallback when DISPLAYING
    // the price — otherwise a buyer could see a local price and be shown
    // USD at checkout, which is precisely the "feels cheated" scenario to
    // avoid. This still needs a matching frontend patch — flagged, not yet
    // done.
    if (!buyerUser?.country) throw new AppError('Please add your country to your profile before purchasing.', 400);
    const provider = resolveCheckoutProvider(buyerUser.country);
    const currencyValid = provider === 'PAYSTACK' ? isPaystackCurrency(currency) : isSkrillCurrency(currency);

    if (!currencyValid) {
      if (template.priceUSD != null)        { amount = template.priceUSD;    currency = 'USD'; }
      else if (template.currency === 'USD') { amount = template.priceLocal; currency = 'USD'; }
      else throw new AppError('This template cannot currently be purchased — no payable price is set.', 400);
    }

    return paymentService.initializeCheckout(buyer.id, {
      type:        'TEMPLATE',
      referenceId: templateId,
      creatorId:   template.creatorId,
      amount,
      currency,
      email:       buyer.email,
      callbackUrl,
    });
  },

  async generateDownloadToken(templateId: string, buyerId: string): Promise<string> {
    const template = await Template.findById(templateId).select('+fileUrl');
    if (!template) throw new AppError('Template not found', 404);
    if (template.status !== 'APPROVED') throw new AppError('Template not available', 403);

    if (template.priceLocal > 0) {
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

    if (template.priceLocal > 0) {
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