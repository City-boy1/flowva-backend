import { JobContent, JobApplicationContent } from '../db/models.js';
import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { messageService } from './message.service.js';

export const jobService = {

  async create(postedBy: string, data: {
    title: string; company: string; description: string;
    fields: string[]; field: string; jobType: string;
    location: string; city?: string;
    salary?: { min?: number; max?: number; period: string; currency: string } | null;
    logoUrl?: string | null; website?: string | null;
  }) {
    const pgJob = await prisma.job.create({
      data: { postedBy, jobType: data.jobType, status: 'open' },
    });

    const mongoJob = await JobContent.create({
      pgJobId:     pgJob.id,
      title:       data.title,
      company:     data.company,
      description: data.description,
      fields:      data.fields,
      field:       data.field,
      location:    data.location,
      city:        data.city ?? '',
      salary:      data.salary ?? undefined,
      website:     data.website ?? '',
      postedBy,
      jobType:     data.jobType,
    });

    await prisma.job.update({
      where: { id: pgJob.id },
      data:  { mongoJobId: mongoJob._id.toString() },
    });

    return { ...pgJob, content: mongoJob };
  },

  async list(query: { field?: string; location?: string; jobType?: string; postedBy?: string; page?: number; limit?: number }) {
    const page  = query.page  || 1;
    const limit = Math.min(query.limit || 20, 50);
    const skip  = (page - 1) * limit;

    const pgJobs = await prisma.job.findMany({
      where: query.postedBy
        ? { postedBy: query.postedBy }
        : { status: 'open' },
      orderBy: { createdAt: 'desc' },
      skip, take: limit,
    });

    const pgIds    = pgJobs.map(j => j.id);
    const filter: Record<string, any> = { pgJobId: { $in: pgIds } };
    if (query.field)    filter.fields    = query.field;
    if (query.location) filter.location  = query.location;
    if (query.jobType)  filter.jobType   = query.jobType;

    const contents   = await JobContent.find(filter).lean();
    const contentMap = Object.fromEntries(contents.map(c => [c.pgJobId, c]));

    return pgJobs.map(j => ({ ...j, content: contentMap[j.id] || null }));
  },

  async getById(id: string) {
    const pg = await prisma.job.findUnique({ where: { id } });
    if (!pg) throw new AppError('Job not found', 404);
    const content = await JobContent.findOne({ pgJobId: id }).lean();
    return { ...pg, content };
  },

  async uploadLogo(file: Express.Multer.File) {
    const { uploadToCloudinary } = await import('../utils/cloudinary.js');
    const result = await uploadToCloudinary(
      (file as any).path ?? (file as any).buffer,
      'job-logos',
      { resource_type: 'image' }
    );
    // Clean up temp file
    if ((file as any).path) {
      const fs = await import('fs/promises');
      await fs.unlink((file as any).path).catch(() => {});
    }
    return result;
  },

  async apply(jobId: string, userId: string, data: {
    coverLetter?: string; portfolioUrl?: string; field?: string;
  }) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'open') throw new AppError('Job not available', 400);

    const existing = await prisma.jobApplication.findUnique({
      where: { jobId_userId: { jobId, userId } },
    });
    if (existing) throw new AppError('You already applied to this job', 409);

    const pgApp = await prisma.jobApplication.create({
      data: { jobId, userId, status: 'PENDING' },
    });

    await JobApplicationContent.create({
      pgApplicationId: pgApp.id,
      pgJobId:         jobId,
      userId,
      coverLetter:     data.coverLetter ?? '',
      portfolioUrl:    data.portfolioUrl ?? '',
      field:           data.field ?? '',
      appliedAt:       new Date(),
    });

    return pgApp;
  },

  async getApplicants(jobId: string, requesterId: string, role: string) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError('Job not found', 404);
    if (job.postedBy !== requesterId && role !== 'ADMIN') throw new AppError('Forbidden', 403);

    const pgApps = await prisma.jobApplication.findMany({
      where: { jobId },
      orderBy: { appliedAt: 'desc' },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });

    const appIds   = pgApps.map(a => a.id);
    const contents = await JobApplicationContent.find({ pgApplicationId: { $in: appIds } }).lean();
    const contMap  = Object.fromEntries(contents.map(c => [c.pgApplicationId, c]));

    return pgApps.map(a => ({
      ...a,
      userId:      a.userId,
      name:        a.user.name,
      avatarUrl:   a.user.avatarUrl,
      coverLetter: contMap[a.id]?.coverLetter ?? '',
      portfolioUrl:contMap[a.id]?.portfolioUrl ?? '',
      field:       contMap[a.id]?.field ?? '',
      appliedAt:   a.appliedAt,
    }));
  },

  async acceptApplicant(jobId: string, userId: string, requesterId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.postedBy !== requesterId) throw new AppError('Forbidden', 403);

  await prisma.jobApplication.update({
    where: { jobId_userId: { jobId, userId } },
    data:  { status: 'ACCEPTED' },
  });
  await prisma.job.update({ where: { id: jobId }, data: { status: 'filled' } });

  const content  = await JobContent.findOne({ pgJobId: jobId }).lean();
  const jobTitle = content?.title ?? 'this role';
  const msg = await messageService.startConversation(
    requesterId, userId,
    `Hi! We've reviewed your application for "${jobTitle}" and would love to have you on board. Let's discuss next steps.`
  );

  return { success: true, conversationId: msg.conversationId };
},

  async rejectApplicant(jobId: string, userId: string, requesterId: string) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.postedBy !== requesterId) throw new AppError('Forbidden', 403);

    await prisma.jobApplication.update({
      where: { jobId_userId: { jobId, userId } },
      data:  { status: 'REJECTED' },
    });

    return { success: true };
  },

  async deleteJob(jobId: string, requesterId: string, role: string) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError('Job not found', 404);
    if (job.postedBy !== requesterId && role !== 'ADMIN') throw new AppError('Forbidden', 403);

    await JobContent.deleteOne({ pgJobId: jobId });
    await prisma.job.delete({ where: { id: jobId } });
  },
};