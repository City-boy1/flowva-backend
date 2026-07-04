import fs from 'fs';
import { Tutorial } from '../db/models.js';
import { AppError } from '../middleware/errorHandler.js';
import { youtubeService } from './youtube.service.js';

export const tutorialService = {

  async create(creatorId: string, data: {
    title:        string;
    description?: string;
    category?:    string;
    tags?:        string[];
    isFree?:      boolean;
    price?:       number;
    templateId?:  string;
    filePath:     string;   // tmp file path from multer
  }) {
    if (!data.filePath) throw new AppError('Video file is required', 400);

    let youtubeId    = '';
    let youtubeUrl   = '';
    let thumbnailUrl = '';

    try {
      const result = await youtubeService.uploadVideo(
        data.filePath,
        data.title,
        data.description ?? '',
        data.tags ?? [],
      );
      youtubeId    = result.youtubeId;
      youtubeUrl   = result.youtubeUrl;
      thumbnailUrl = result.thumbnailUrl;
    } finally {
      // Always clean up tmp file
      try { fs.unlinkSync(data.filePath); } catch {}
    }

    return Tutorial.create({
      creatorId,
      templateId:      data.templateId ?? null,
      title:           data.title,
      description:     data.description,
      category:        data.category,
      tags:            data.tags || [],
      isFree:          data.isFree ?? true,
      price:           data.price || 0,
      youtubeUrl,
      youtubeId,
      videoUrl:        youtubeUrl,
      videoPublicId:   youtubeId,
      thumbnailUrl,
      status:          'PENDING',
      approvedBy:      null,
      approvedAt:      null,
      rejectedBy:      null,
      rejectedAt:      null,
      rejectionReason: null,
    });
  },

  async list(query: {
    category?:  string;
    status?:    string;
    creatorId?: string;
    page?:      number;
    limit?:     number;
  }) {
    const filter: Record<string, any> = {};
    filter.status = query.status ?? (query.creatorId ? { $ne: 'REJECTED' } : 'APPROVED');
    if (query.category)  filter.category  = query.category;
    if (query.creatorId) filter.creatorId = query.creatorId;

    const page  = query.page  || 1;
    const limit = Math.min(query.limit || 20, 50);

    return Tutorial.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
  },

  async getById(id: string, requesterRole?: string) {
    const tutorial = await Tutorial.findById(id).lean();
    if (!tutorial) throw new AppError('Tutorial not found', 404);
    if (tutorial.status !== 'APPROVED' && requesterRole !== 'ADMIN') {
      throw new AppError('Tutorial not found', 404);
    }
    return tutorial;
  },

  async pending() {
    return Tutorial.find({ status: 'PENDING' }).sort({ createdAt: -1 }).lean();
  },

  // ADMIN — APPROVE: make video public on YouTube
  async approve(id: string, adminId: string) {
    const tutorial = await Tutorial.findById(id);
    if (!tutorial) throw new AppError('Tutorial not found', 404);

    // Make public on YouTube
    if (tutorial.youtubeId) {
      await youtubeService.setPublic(tutorial.youtubeId);
    }

    return Tutorial.findByIdAndUpdate(
      id,
      {
        status:          'APPROVED',
        approvedBy:      adminId,
        approvedAt:      new Date(),
        rejectedBy:      null,
        rejectedAt:      null,
        rejectionReason: null,
      },
      { new: true },
    );
  },

  // ADMIN — REJECT: set private on YouTube (not deleted yet)
  async reject(id: string, adminId: string, reason: string) {
    const tutorial = await Tutorial.findById(id);
    if (!tutorial) throw new AppError('Tutorial not found', 404);

    // Set private on YouTube
    if (tutorial.youtubeId) {
      await youtubeService.setPrivate(tutorial.youtubeId);
    }

    return Tutorial.findByIdAndUpdate(
      id,
      {
        status:          'REJECTED',
        rejectedBy:      adminId,
        rejectedAt:      new Date(),
        rejectionReason: reason,
        approvedBy:      null,
        approvedAt:      null,
      },
      { new: true },
    );
  },

  async unpublish(id: string, adminId: string, reason: string) {
    const tutorial = await Tutorial.findById(id);
    if (!tutorial) throw new AppError('Tutorial not found', 404);
    if (tutorial.status !== 'APPROVED') {
      throw new AppError('Only approved tutorials can be unpublished', 400);
    }

    // Set back to unlisted on YouTube
    if (tutorial.youtubeId) {
      await youtubeService.setPrivate(tutorial.youtubeId);
    }

    return Tutorial.findByIdAndUpdate(
      id,
      {
        status:          'PENDING',
        rejectedBy:      adminId,
        rejectedAt:      new Date(),
        rejectionReason: reason,
        approvedBy:      null,
        approvedAt:      null,
      },
      { new: true },
    );
  },

  async listByStatus(status: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return Tutorial.find({ status }).sort({ createdAt: -1 }).lean();
  },

  // ADMIN — PERMANENT DELETE: removes from YouTube + DB
  async permanentDelete(id: string) {
    const tutorial = await Tutorial.findById(id);
    if (!tutorial) throw new AppError('Tutorial not found', 404);
    if (tutorial.status !== 'REJECTED') {
      throw new AppError('Tutorial must be rejected before permanent deletion', 403);
    }

    // Delete from YouTube
    if (tutorial.youtubeId) {
      await youtubeService.deleteVideo(tutorial.youtubeId);
    }

    await Tutorial.findByIdAndDelete(id);
  },
};