import type { Request, Response } from 'express';
import { z } from 'zod';
import { templateService } from '../services/template.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';

const createSchema = z.object({
  title:       z.string().min(3).max(150).trim(),
  description: z.string().min(10).max(2000).trim(),
  category:    z.string().min(2).max(60),
  tags:        z.preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.array(z.string()).max(10)).optional().default([]),
  software:    z.preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.array(z.string()).max(10)).optional().default([]),
  // priceLocal is always required — in `currency`, which is either the
  // creator's own currency or 'USD' if that's already their country's
  // currency. priceUSD is the optional add-on that makes the template
  // visible/purchasable to buyers outside the creator's own country.
  priceLocal:  z.preprocess(Number, z.number().min(0.01, 'Price is required')),
  priceUSD:    z.preprocess(
                 v => (v === undefined || v === '' ? undefined : Number(v)),
                 z.number().min(0.01).optional(),
               ),
  currency:    z.string().length(3).default('USD'),
});

export const templateController = {

  // Single file — preview auto-generated inside templateService.create
  create: asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const file      = files?.file?.[0];
  const thumbnail = files?.thumbnail?.[0];
  const preview   = files?.preview?.[0];

  if (!file)      throw new AppError('Template file required', 400);
  if (!thumbnail) throw new AppError('Thumbnail image required', 400);

  const data = createSchema.parse(req.body);

  const template = await templateService.create(req.user!.id, {
    ...data,
    fileBuffer:            (file as any).buffer,
    filePath:              (file as any).path,
    fileMime:              file.mimetype,
    fileSizeBytes:         file.size,
    originalName:          file.originalname,
    thumbnailBuffer:       (thumbnail as any).buffer,
    thumbnailPath:         (thumbnail as any).path,
    thumbnailMime:         thumbnail.mimetype,
    thumbnailSizeBytes:    thumbnail.size,
    previewVideoBuffer:    (preview as any)?.buffer,
    previewVideoPath:      (preview as any)?.path,
    previewVideoMime:      preview?.mimetype,
    previewVideoSizeBytes: preview?.size,
  });

  res.status(201).json({ success: true, template });
}),

  list: asyncHandler(async (req: Request, res: Response) => {
    const { category, search, page, limit, sort, creatorId, status } = req.query as Record<string, string>;
    // Admins can filter by status; public always gets APPROVED only (handled in service)
    const queryStatus =
      req.user?.role === 'ADMIN' || req.user?.id === creatorId
      ? status
      : undefined;    const result = await templateService.list({
      category, search, creatorId, status: queryStatus,
      page: +page || 1, limit: +limit || 20, sort,
    });
    res.json({ success: true, ...result });
  }),

  getOne: asyncHandler(async (req: Request, res: Response) => {
    const template = await templateService.getById(req.params.id, req.user?.role);
    res.json({ success: true, template });
  }),

  download: asyncHandler(async (req: Request, res: Response) => {
    const url = await templateService.getDownloadUrl(req.params.id, req.user!.id);
    res.json({ success: true, url });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
  const updateSchema = z.object({
    title:       z.string().min(3).max(150).trim().optional(),
    description: z.string().min(10).max(2000).trim().optional(),
    category:    z.string().min(2).max(60).optional(),
    tags:        z.preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.array(z.string()).max(10)).optional(),
    software:    z.preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.array(z.string()).max(10)).optional(),
    priceLocal:  z.preprocess(Number, z.number().min(0.01)).optional(),
    priceUSD:    z.preprocess(
                   v => (v === undefined || v === '' ? undefined : Number(v)),
                   z.number().min(0.01).optional(),
                 ),
    currency:    z.string().length(3).optional(),
  });
  const safe = updateSchema.parse(req.body);
  const template = await templateService.update(req.params.id, req.user!.id, safe);
  res.json({ success: true, template });
}),

  delete: asyncHandler(async (req: Request, res: Response) => {
    await templateService.delete(req.params.id, req.user!.id, req.user!.role);
    res.json({ success: true });
  }),

  approve: asyncHandler(async (req: Request, res: Response) => {
  const template = await templateService.approve(
    req.params.id,
    req.user!.id
  );

  res.json({
    success: true,
    template,
  });
}),


  reject: asyncHandler(async (req: Request, res: Response) => {
  const { reason } = z.object({
    reason: z.string().min(5),
  }).parse(req.body);

  const template = await templateService.reject(
    req.params.id,
    reason,
    req.user!.id
  );

  res.json({
    success: true,
    template,
  });
}),

  unpublish: asyncHandler(async (req: Request, res: Response) => {
    const { reason } = z.object({
      reason: z.string().min(5),
    }).parse(req.body);

    const template = await templateService.unpublish(
      req.params.id,
      reason,
      req.user!.id,
    );

    res.json({ success: true, template });
  }),

  permanentDelete: asyncHandler(async (req: Request, res: Response) => {
    await templateService.permanentlyDeleteRejected(
      req.params.id,
      req.user!.id,
    );

    res.json({ success: true });
  }),

  purchase: asyncHandler(async (req: Request, res: Response) => {
  const { callbackUrl } = z.object({ callbackUrl: z.string().url() }).parse(req.body);
  const result = await templateService.purchase(req.params.id, req.user!, callbackUrl);
  res.json({ success: true, ...result });
}),

rateTemplate: asyncHandler(async (req: Request, res: Response) => {
    const { orderId, score, review } = z.object({
      orderId: z.string(),
      score:   z.number().int().min(1).max(5),
      review:  z.string().max(500).optional(),
    }).parse(req.body);

    const result = await templateService.rateTemplate(
      req.params.id,
      req.user!.id,
      { orderId, score, review }
    );
    res.status(201).json({ success: true, ...result });
  }),

  getTemplateRatings: asyncHandler(async (req: Request, res: Response) => {
    const ratings = await templateService.getTemplateRatings(req.params.id);
    res.json({ success: true, ratings });
  }),

// After the existing `download` handler, add:

generateDownloadToken: asyncHandler(async (req: Request, res: Response) => {
  const token = await templateService.generateDownloadToken(req.params.id, req.user!.id);
  res.json({ success: true, token });
}),

downloadWithToken: asyncHandler(async (req: Request, res: Response) => {
  const { token } = z.object({ token: z.string() }).parse(req.query);
  // No req.user — buyerId comes from the signed token itself
  const url = await templateService.downloadWithToken(token);
  res.redirect(302, url);
}),
};