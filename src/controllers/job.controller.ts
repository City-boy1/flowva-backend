import type { Request, Response } from 'express';
import { z } from 'zod';
import { jobService } from '../services/job.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';

const createSchema = z.object({
  title:       z.string().min(3).max(150),
  company:     z.string().min(1).max(120),
  description: z.string().min(50).max(6000),
  fields:      z.array(z.string()).min(1).max(5),
  field:       z.string(),
  jobType:     z.enum(['full-time', 'contract']),
  location:    z.enum(['remote', 'hybrid', 'onsite']),
  city:        z.string().optional().nullable(),
  salary:      z.object({
    min:      z.number().optional().nullable(),
    max:      z.number().optional().nullable(),
    period:   z.string(),
    currency: z.string(),
  }).optional().nullable(),
  logoUrl:  z.string().url().optional().nullable(),
  website:  z.string().url().optional().nullable(),
  postedBy: z.string().optional(), // ignored — taken from req.user
  status:   z.string().optional(), // ignored — always 'open'
});

export const jobController = {

  create: asyncHandler(async (req: Request, res: Response) => {
    const parsed = createSchema.parse(req.body);
    const result = await jobService.create(req.user!.id, {
      ...parsed,
      city:    parsed.city    ?? undefined,
      logoUrl: parsed.logoUrl ?? undefined,
      website: parsed.website ?? undefined,
      salary: parsed.salary ? {
  ...parsed.salary,
  min: parsed.salary.min ?? undefined,
  max: parsed.salary.max ?? undefined,
} : undefined,
    });
    res.status(201).json({ success: true, job: result });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
  const { field, location, jobType, postedBy, page, limit } = req.query as Record<string, string>;
  const result = await jobService.list({ field, location, jobType, postedBy, page: +page || 1, limit: +limit || 20 });
  res.json({ success: true, jobs: result });
}),

  getOne: asyncHandler(async (req: Request, res: Response) => {
    const job = await jobService.getById(req.params.id);
    res.json({ success: true, job });
  }),

  uploadLogo: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw new AppError('No file provided', 400);
    const result = await jobService.uploadLogo(req.file);
    res.json({ success: true, url: result.url });
  }),

  apply: asyncHandler(async (req: Request, res: Response) => {
    const { coverLetter, portfolioUrl, field } = z.object({
      coverLetter:  z.string().optional(),
      portfolioUrl: z.string().url().optional(),
      field:        z.string().optional(),
    }).parse(req.body);
    const app = await jobService.apply(req.params.id, req.user!.id, { coverLetter, portfolioUrl, field });
    res.status(201).json({ success: true, application: app });
  }),

  getApplicants: asyncHandler(async (req: Request, res: Response) => {
    const applicants = await jobService.getApplicants(req.params.id, req.user!.id, req.user!.role);
    res.json({ success: true, applicants });
  }),

  acceptApplicant: asyncHandler(async (req: Request, res: Response) => {
    const result = await jobService.acceptApplicant(req.params.id, req.params.userId, req.user!.id);
    res.json({ ...result, success: true });
  }),

  rejectApplicant: asyncHandler(async (req: Request, res: Response) => {
    const result = await jobService.rejectApplicant(req.params.id, req.params.userId, req.user!.id);
    res.json({ ...result, success: true });
  }),

  deleteJob: asyncHandler(async (req: Request, res: Response) => {
    await jobService.deleteJob(req.params.id, req.user!.id, req.user!.role);
    res.json({ success: true });
  }),
};