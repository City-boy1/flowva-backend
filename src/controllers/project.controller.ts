import type { Request, Response } from 'express';
import { z } from 'zod';
import { projectService } from '../services/project.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const createSchema = z.object({
  title: z.string().min(4).max(200),
  description: z.string().min(20).max(5000),
  category: z.string().optional(),
  skills: z.array(z.string()).default([]),
  budget: z.number().positive(),
  currency: z.string().default('USD'),
  deadline: z.string(),
  software: z.string().nullable().optional(),
  experience: z.string().nullable().optional(),
  attachments: z.array(z.string().url()).default([]),
});

const bidSchema = z.object({
  amount: z.number().positive(),
  proposal: z.string().min(50).max(3000),
  deliveryDays: z.number().int().positive(),
  sampleUrls: z.array(z.string().url()).optional(),
});

export const projectController = {
   create: asyncHandler(async (req: Request, res: Response) => {
  const parsed = createSchema.parse(req.body);
  const data = {
    ...parsed,
    category: parsed.category ?? '',
    software: parsed.software ?? undefined,
    experience: parsed.experience ?? undefined,
  };
  const result = await projectService.create(req.user!.id, data);
    res.status(201).json({ success: true, project: result });
  }),

   list: asyncHandler(async (req: Request, res: Response) => {
   const { category, search, page, limit, scope, role, userId: queryUserId } = req.query as Record<string, string>;
    const userId = queryUserId || req.user?.id;

    const result = await projectService.list({ category, search, page: +page || 1, limit: +limit || 20, scope, userId, role });
    res.json({ success: true, projects: result });
  }),

  getOne: asyncHandler(async (req: Request, res: Response) => {
    const project = await projectService.getById(req.params.id);
    res.json({ success: true, project });
  }),

  submitBid: asyncHandler(async (req: Request, res: Response) => {
    const data = bidSchema.parse(req.body);
    const bid = await projectService.submitBid(req.params.id, req.user!.id, data);
    res.status(201).json({ success: true, bid });
  }),

  getBids: asyncHandler(async (req: Request, res: Response) => {
    const bids = await projectService.getBids(req.params.id, req.user!.id, req.user!.role);
    res.json({ success: true, bids });
  }),

  acceptBid: asyncHandler(async (req: Request, res: Response) => {
    const bid = await projectService.acceptBid(req.params.id, req.params.bidId, req.user!.id);
    res.json({ success: true, bid });
  }),

  rejectBid: asyncHandler(async (req: Request, res: Response) => {
    await projectService.rejectBid(req.params.id, req.params.bidId, req.user!.id);
    res.json({ success: true });
  }),

  withdrawBid: asyncHandler(async (req: Request, res: Response) => {
    await projectService.withdrawBid(req.params.id, req.params.bidId, req.user!.id);
    res.json({ success: true });
  }),

  approve: asyncHandler(async (req: Request, res: Response) => {
    const project = await projectService.approve(req.params.id);
    res.json({ success: true, project });
  }),

  deliver: asyncHandler(async (req: Request, res: Response) => {
  const { deliveryNote, fileUrl } = z.object({
    deliveryNote: z.string().min(1),
    fileUrl: z.string().url(),
  }).parse(req.body);
  const result = await projectService.deliver(req.params.id, req.user!.id, deliveryNote, fileUrl);
  res.json({ success: true, project: result });
}),

approveDelivery: asyncHandler(async (req: Request, res: Response) => {
  const order = await projectService.approveDelivery(req.params.id, req.user!.id);
  res.json({ success: true, order });
}),

requestRevision: asyncHandler(async (req: Request, res: Response) => {
  const { note } = z.object({ note: z.string().min(5) }).parse(req.body);
  const project = await projectService.requestRevision(req.params.id, req.user!.id, note);
  res.json({ success: true, project });
}),

openDispute: asyncHandler(async (req: Request, res: Response) => {
  const { reason } = z.object({ reason: z.string().min(10) }).parse(req.body);
  const project = await projectService.openDispute(req.params.id, req.user!.id, reason);
  res.json({ success: true, project });
}),
};