import type { Response } from 'express';
import type { AuthRequest } from '../types/index.js';
import mongoose, { Schema, Document, Model } from 'mongoose';
import { Template } from '../db/mongoose.js';
import prisma from '../db/prisma.js';

// ── Review model (defined here, close to its controller) ──
interface IReview extends Document {
  templateId: mongoose.Types.ObjectId;
  buyerId:    string;  // MongoDB user ID
  buyerName:  string;
  rating:     number;
  comment:    string;
  createdAt:  Date;
}

const ReviewSchema = new Schema<IReview>({
  templateId: { type: Schema.Types.ObjectId, ref: 'Template', required: true, index: true },
  buyerId:    { type: String, required: true },
  buyerName:  { type: String, required: true },
  rating:     { type: Number, required: true, min: 1, max: 5 },
  comment:    { type: String, required: true, maxlength: 1000, trim: true },
}, { timestamps: true });

// One review per buyer per template
ReviewSchema.index({ templateId: 1, buyerId: 1 }, { unique: true });

const Review: Model<IReview> =
  mongoose.models.Review ?? mongoose.model<IReview>('Review', ReviewSchema);

// ── GET REVIEWS FOR A TEMPLATE ────────────────────────
export async function getReviews(req: AuthRequest & { params: { templateId: string } }, res: Response): Promise<void> {
  const reviews = await Review.find({ templateId: req.params.templateId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json({ success: true, data: reviews });
}

// ── CREATE REVIEW ─────────────────────────────────────
export async function createReview(req: AuthRequest, res: Response): Promise<void> {
  const { templateId } = req.params;
  const { rating, comment } = req.body as { rating: number; comment: string };

  // Must have purchased the template
  const pgUser = await prisma.user.findUnique({ where: { mongoId: req.user!.id } });
  const hasPurchased = pgUser
    ? await prisma.order.findFirst({
        where: { buyerId: pgUser.id, templateMongoId: templateId, status: 'PAID' },
      })
    : null;

  if (!hasPurchased) {
    res.status(403).json({ success: false, message: 'You must purchase this template before reviewing it' });
    return;
  }

  // Prevent duplicate reviews
  const existing = await Review.findOne({ templateId, buyerId: req.user!.id });
  if (existing) {
    res.status(409).json({ success: false, message: 'You have already reviewed this template' });
    return;
  }

  const review = await Review.create({
    templateId,
    buyerId:   req.user!.id,
    buyerName: req.user!.name,
    rating:    Number(rating),
    comment,
  });

  // Recalculate template's average rating
  const stats = await Review.aggregate([
    { $match: { templateId: new mongoose.Types.ObjectId(templateId) } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  if (stats[0]) {
    await Template.findByIdAndUpdate(templateId, {
      rating:      Math.round(stats[0].avg * 10) / 10,
      ratingCount: stats[0].count,
    });
  }

  res.status(201).json({ success: true, data: review });
}