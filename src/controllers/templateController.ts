import type { Request, Response } from 'express';
import type { AuthRequest } from '../types/index.js';
import { Template } from '../db/mongoose.js';
import { cloudinary } from '../middleware/upload.js';
import logger from '../utils/logger.js';

// ── GET ALL TEMPLATES (with filters) ─────────────────
export async function getTemplates(req: Request, res: Response): Promise<void> {
  const {
    page     = '1',
    limit    = '12',
    category,
    sort     = 'trending',
    search,
    price,
    trending,
  } = req.query as Record<string, string>;

  const pageNum  = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, parseInt(limit));
  const skip     = (pageNum - 1) * limitNum;

  // Build filter
  const filter: Record<string, unknown> = { isPublished: true };

  if (category && category !== 'all') filter.category = category.toLowerCase();
  if (trending === 'true') filter.isTrending = true;

  if (price) {
    if (price === 'low')  filter.price = { $lt: 20 };
    if (price === 'mid')  filter.price = { $gte: 20, $lte: 35 };
    if (price === 'high') filter.price = { $gt: 35 };
    if (price === 'free') filter.price = 0;
  }

  if (search) {
    filter.$text = { $search: search };
  }

  // Build sort
  const sortMap: Record<string, Record<string, 1 | -1>> = {
    trending:    { isTrending: -1, sales: -1 },
    newest:      { createdAt: -1 },
    'price-low': { price: 1 },
    'price-high':{ price: -1 },
    rating:      { rating: -1 },
    'best-selling': { sales: -1 },
  };
  const sortObj = sortMap[sort] ?? sortMap.trending;

  const [templates, total] = await Promise.all([
    Template.find(filter).sort(sortObj).skip(skip).limit(limitNum).lean(),
    Template.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      templates,
      total,
      page:       pageNum,
      totalPages: Math.ceil(total / limitNum),
      hasMore:    skip + limitNum < total,
    },
  });
}

// ── GET SINGLE TEMPLATE ───────────────────────────────
export async function getTemplate(req: Request, res: Response): Promise<void> {
  const template = await Template.findById(req.params.id).populate('creator', 'name avatar');

  if (!template) {
    res.status(404).json({ success: false, message: 'Template not found' });
    return;
  }

  res.json({ success: true, data: template });
}

// ── CREATE TEMPLATE (with file uploads) ───────────────
export async function createTemplate(req: AuthRequest, res: Response): Promise<void> {
  const { title, description, category, price, software, tags } = req.body as {
    title: string; description: string; category: string;
    price: number; software?: string; tags?: string[];
  };

  // URLs populated by processBothFiles middleware (Cloudinary upload_stream)
  const thumbnailUrl = req.cloudinaryUrls?.thumbnailUrl;
  const downloadUrl  = req.cloudinaryUrls?.downloadUrl;

  if (!thumbnailUrl) {
    res.status(400).json({ success: false, message: 'Thumbnail image is required' });
    return;
  }

  if (!downloadUrl) {
    res.status(400).json({ success: false, message: 'Template file (ZIP or MP4) is required' });
    return;
  }

  const template = await Template.create({
    title,
    description,
    category:    category.toLowerCase(),
    price:       Number(price),
    software,
    tags:        tags ?? [],
    creator:     req.user!.id,
    creatorName: req.user!.name,
    thumbnailUrl,
    downloadUrl,
    isPublished: true,
  });

  logger.info(`Template created: "${title}" by ${req.user!.email}`);

  res.status(201).json({
    success: true,
    message: 'Template published successfully',
    data: template,
  });
}

// ── UPDATE TEMPLATE ───────────────────────────────────
export async function updateTemplate(req: AuthRequest, res: Response): Promise<void> {
  const template = await Template.findById(req.params.id);

  if (!template) {
    res.status(404).json({ success: false, message: 'Template not found' });
    return;
  }

  // Only the creator or admin can update
  if (template.creator.toString() !== req.user!.id && req.user!.role !== 'ADMIN') {
    res.status(403).json({ success: false, message: 'Not authorised' });
    return;
  }

  const allowed = ['title', 'description', 'category', 'price', 'software', 'tags', 'isPublished'];
  allowed.forEach(field => {
    if (req.body[field] !== undefined) {
      (template as Record<string, unknown>)[field] = req.body[field];
    }
  });

  await template.save();
  res.json({ success: true, message: 'Template updated', data: template });
}

// ── DELETE TEMPLATE ───────────────────────────────────
export async function deleteTemplate(req: AuthRequest, res: Response): Promise<void> {
  const template = await Template.findById(req.params.id);

  if (!template) {
    res.status(404).json({ success: false, message: 'Template not found' });
    return;
  }

  if (template.creator.toString() !== req.user!.id && req.user!.role !== 'ADMIN') {
    res.status(403).json({ success: false, message: 'Not authorised' });
    return;
  }

  // Delete from Cloudinary
  try {
    const thumbPublicId = template.thumbnailUrl.split('/').pop()?.split('.')[0];
    const filePublicId  = template.downloadUrl.split('/').pop()?.split('.')[0];
    if (thumbPublicId) await cloudinary.uploader.destroy(`flowva/thumbnails/${thumbPublicId}`);
    if (filePublicId)  await cloudinary.uploader.destroy(`flowva/templates/${filePublicId}`, { resource_type: 'raw' });
  } catch (err) {
    logger.warn('Cloudinary cleanup failed during template delete', err);
  }

  await template.deleteOne();
  res.json({ success: true, message: 'Template deleted' });
}

// ── GET CREATOR'S OWN TEMPLATES ───────────────────────
export async function getMyTemplates(req: AuthRequest, res: Response): Promise<void> {
  const templates = await Template.find({ creator: req.user!.id })
    .sort({ createdAt: -1 })
    .lean();

  res.json({ success: true, data: templates });
}