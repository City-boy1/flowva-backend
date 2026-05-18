import { Router } from 'express';
import { getReviews, createReview } from '../controllers/reviewController.js';
import { protect } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';

const reviewSchema = z.object({
  rating:  z.coerce.number().min(1).max(5),
  comment: z.string().min(5).max(1000).trim(),
});

const router = Router({ mergeParams: true }); // gets :templateId from parent

// GET  /api/templates/:templateId/reviews
router.get('/', asyncHandler(getReviews as Parameters<typeof asyncHandler>[0]));

// POST /api/templates/:templateId/reviews  (must be logged in + purchased)
router.post('/', protect, validate(reviewSchema), asyncHandler(createReview as Parameters<typeof asyncHandler>[0]));

export default router;