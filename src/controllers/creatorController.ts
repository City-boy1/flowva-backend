import type { Request, Response } from 'express';
import { User, Template } from '../db/mongoose.js';

// ── GET ALL CREATORS (public listing) ─────────────────
export async function getCreators(req: Request, res: Response): Promise<void> {
  const { page = '1', limit = '12', sort = 'sales' } = req.query as Record<string, string>;

  const pageNum  = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, parseInt(limit));
  const skip     = (pageNum - 1) * limitNum;

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    sales:     { totalSales:   -1 },
    revenue:   { totalRevenue: -1 },
    newest:    { createdAt:    -1 },
  };

  const [creators, total] = await Promise.all([
    User.find({ role: 'creator' })
      .select('name avatar bio tags totalSales totalRevenue createdAt')
      .sort(sortMap[sort] ?? sortMap.sales)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    User.countDocuments({ role: 'creator' }),
  ]);

  // Attach template count for each creator
  const creatorIds = creators.map(c => c._id);
  const templateCounts = await Template.aggregate([
    { $match: { creator: { $in: creatorIds }, isPublished: true } },
    { $group: { _id: '$creator', count: { $sum: 1 } } },
  ]);

  const countMap = Object.fromEntries(templateCounts.map(t => [t._id.toString(), t.count]));

  const result = creators.map(c => ({
    ...c,
    templateCount: countMap[c._id.toString()] ?? 0,
  }));

  res.json({
    success: true,
    data: {
      creators:   result,
      total,
      page:       pageNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
}

// ── GET SINGLE CREATOR PROFILE (public) ───────────────
export async function getCreatorProfile(req: Request, res: Response): Promise<void> {
  const creator = await User.findById(req.params.id)
    .select('name avatar bio tags totalSales totalRevenue createdAt role')
    .lean();

  if (!creator || creator.role !== 'creator') {
    res.status(404).json({ success: false, message: 'Creator not found' });
    return;
  }

  const templates = await Template.find({
    creator:     req.params.id,
    isPublished: true,
  })
    .sort({ sales: -1 })
    .limit(20)
    .lean();

  const templateCount = await Template.countDocuments({
    creator:     req.params.id,
    isPublished: true,
  });

  res.json({
    success: true,
    data: {
      creator: { ...creator, templateCount },
      templates,
    },
  });
}