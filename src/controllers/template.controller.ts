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
  price:       z.preprocess(Number, z.number().min(0)),
  currency:    z.string().default('USD'),
});

export const templateController = {

  // Single file — preview auto-generated inside templateService.create
  create: asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new AppError('Template file required', 400);

  const data = createSchema.parse(req.body);

  // multer diskStorage gives file.path; memoryStorage gives file.buffer
  const template = await templateService.create(req.user!.id, {
    ...data,
    fileBuffer:    (file as any).buffer,        // present only for memory storage
    filePath:      (file as any).path,          // present only for disk storage
    fileMime:      file.mimetype,
    fileSizeBytes: file.size,
    originalName:  file.originalname,
  });

  res.status(201).json({ success: true, template });
}),

  list: asyncHandler(async (req: Request, res: Response) => {
    const { category, search, page, limit, sort, creatorId, status } = req.query as Record<string, string>;
    // Admins can filter by status; public always gets APPROVED only (handled in service)
    const queryStatus = req.user?.role === 'ADMIN' ? status : undefined;
    const result = await templateService.list({
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
    price:       z.preprocess(Number, z.number().min(0)).optional(),
    currency:    z.string().optional(),
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