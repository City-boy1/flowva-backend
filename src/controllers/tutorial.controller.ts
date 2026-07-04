import type { Request, Response } from 'express';
import { z } from 'zod';
import { tutorialService } from '../services/tutorial.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';

export const tutorialController = {

  create: asyncHandler(async (req: Request, res: Response) => {
    const file = (req as any).file;
    if (!file) throw new AppError('Video file is required', 400);

    const data = z.object({
      title:       z.string().min(3).max(200),
      description: z.string().max(2000).optional(),
      category:    z.string().optional(),
      templateId:  z.string().optional(),
      tags: z.preprocess(
        (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return []; } },
        z.array(z.string()),
      ).optional(),
      isFree: z.preprocess(
        (v) => v === 'true' || v === true,
        z.boolean(),
      ).optional(),
      price: z.preprocess(Number, z.number().min(0)).optional(),
    }).parse(req.body);

    const tutorial = await tutorialService.create(req.user!.id, {
      ...data,
      filePath: file.path,
    });

    res.status(201).json({ success: true, tutorial });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const { category, software, page, limit, status, creatorId } =
      req.query as Record<string, string>;

    const queryStatus =
      req.user?.role === 'ADMIN' || req.user?.id === creatorId
        ? status
        : undefined;

    const result = await tutorialService.list({
      category:  software || category,
      status:    queryStatus,
      creatorId,
      page:      +page  || 1,
      limit:     Math.min(+limit || 20, 100),
    });

    res.json({ success: true, tutorials: result });
  }),

  getOne: asyncHandler(async (req: Request, res: Response) => {
    const tutorial = await tutorialService.getById(req.params.id, req.user?.role);
    res.json({ success: true, tutorial });
  }),

  pending: asyncHandler(async (_req: Request, res: Response) => {
    const tutorials = await tutorialService.pending();
    res.json({ success: true, tutorials });
  }),

  approve: asyncHandler(async (req: Request, res: Response) => {
    const tutorial = await tutorialService.approve(req.params.id, req.user!.id);
    res.json({ success: true, tutorial });
  }),

  reject: asyncHandler(async (req: Request, res: Response) => {
    const { reason } = z.object({
      reason: z.string().min(5),
    }).parse(req.body);
    const tutorial = await tutorialService.reject(req.params.id, req.user!.id, reason);
    res.json({ success: true, tutorial });
  }),

  unpublish: asyncHandler(async (req: Request, res: Response) => {
    const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);
    const tutorial = await tutorialService.unpublish(req.params.id, req.user!.id, reason);
    res.json({ success: true, tutorial });
  }),

  listByStatus: asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.query as { status?: string };
    const valid = ['PENDING', 'APPROVED', 'REJECTED'];
    if (!status || !valid.includes(status)) throw new AppError('Invalid status', 400);
    const tutorials = await tutorialService.listByStatus(
      status as 'PENDING' | 'APPROVED' | 'REJECTED',
    );
    res.json({ success: true, tutorials });
  }),

  permanentDelete: asyncHandler(async (req: Request, res: Response) => {
    await tutorialService.permanentDelete(req.params.id);
    res.json({ success: true, message: 'Tutorial permanently deleted' });
  }),
};