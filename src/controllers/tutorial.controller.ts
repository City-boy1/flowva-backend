import type { Request, Response } from 'express';
import { z } from 'zod';
import { tutorialService } from '../services/tutorial.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';

export const tutorialController = {

  create: asyncHandler(async (req: Request, res: Response) => {
    const files = req.files as {
      video?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    };

    if (!files?.video?.[0]) {
      throw new AppError('Video file required', 400);
    }

    const data = z.object({
      title: z.string().min(3).max(200),
      description: z.string().max(2000).optional(),
      category: z.string().optional(),

      tags: z.preprocess(
        (v) => typeof v === 'string' ? JSON.parse(v) : v,
        z.array(z.string())
      ).optional(),

      isFree: z.preprocess(
        (v) => v === 'true',
        z.boolean()
      ).optional(),

      price: z.preprocess(
        Number,
        z.number().min(0)
      ).optional(),
    }).parse(req.body);

    const videoFile = files.video[0];
    const thumbFile = files.thumbnail?.[0];

    const tutorial = await tutorialService.create(req.user!.id, {
      ...data,
      videoPath:   (videoFile as any).path,
      videoBuffer: (videoFile as any).buffer,   // null on disk storage, kept for type compat
      thumbPath:   (thumbFile as any)?.path,
      thumbBuffer: (thumbFile as any)?.buffer,
    });

    res.status(201).json({
      success: true,
      tutorial,
    });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
const { category, software, page, limit, status } =
  req.query as Record<string, string>;

    const queryStatus =
      req.user?.role === 'ADMIN'
        ? status
        : undefined;

const result = await tutorialService.list({
  category: software || category,   // frontend sends 'software', fallback to 'category'
  status: queryStatus,
  page: +page || 1,
  limit: Math.min(+limit || 20, 100),
});


    res.json({
      success: true,
      tutorials: result,
    });
  }),

  getOne: asyncHandler(async (req: Request, res: Response) => {
    const tutorial = await tutorialService.getById(
      req.params.id,
      req.user?.role,
    );

    res.json({
      success: true,
      tutorial,
    });
  }),

  // ADMIN — GET PENDING TUTORIALS
  pending: asyncHandler(async (_req: Request, res: Response) => {
    const tutorials = await tutorialService.pending();

    res.json({
      success: true,
      tutorials,
    });
  }),

  // ADMIN — APPROVE
  approve: asyncHandler(async (req: Request, res: Response) => {
    const tutorial = await tutorialService.approve(
      req.params.id,
      req.user!.id,
    );

    res.json({
      success: true,
      tutorial,
    });
  }),

  // ADMIN — REJECT
  reject: asyncHandler(async (req: Request, res: Response) => {

    const { reason } = z.object({
      reason: z.string().min(5),
    }).parse(req.body);

    const tutorial = await tutorialService.reject(
      req.params.id,
      req.user!.id,
      reason,
    );

    res.json({
      success: true,
      tutorial,
    });
  }),

  unpublish: asyncHandler(async (req: Request, res: Response) => {
  const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);
  const tutorial = await tutorialService.unpublish(
    req.params.id,
    req.user!.id,
    reason,
  );
  res.json({ success: true, tutorial });
}),

  // ── ADD START ──
listByStatus: asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as { status?: string };
  const valid = ['PENDING', 'APPROVED', 'REJECTED'];
  if (!status || !valid.includes(status)) {
    throw new AppError('Invalid status', 400);
  }
  const tutorials = await tutorialService.listByStatus(
    status as 'PENDING' | 'APPROVED' | 'REJECTED'
  );
  res.json({ success: true, tutorials });
}),

permanentDelete: asyncHandler(async (req: Request, res: Response) => {
  await tutorialService.permanentDelete(req.params.id);
  res.json({ success: true, message: 'Tutorial permanently deleted' });
}),
};