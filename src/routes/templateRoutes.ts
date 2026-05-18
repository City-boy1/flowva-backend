import { Router } from 'express';
import {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getMyTemplates,
} from '../controllers/templateController.js';
import { protect, requireCreator } from '../middleware/auth.js';
import { validate, templateCreateSchema } from '../middleware/validate.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { multerBoth, processBothFiles } from '../middleware/upload.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// GET  /api/templates           — public, supports ?category, ?sort, ?search, ?price, ?page
router.get('/',         asyncHandler(getTemplates));

// GET  /api/templates/mine      — creator's own templates (auth required)
router.get('/mine',     protect, requireCreator, asyncHandler(getMyTemplates));

// GET  /api/templates/:id       — single template
router.get('/:id',      asyncHandler(getTemplate));

// POST /api/templates           — create (creator only, file upload)
router.post(
  '/',
  protect,
  requireCreator,
  uploadLimiter,
  multerBoth,                       // buffers files in memory
  processBothFiles,                  // streams to Cloudinary, sets req.cloudinaryUrls
  validate(templateCreateSchema),
  asyncHandler(createTemplate)
);

// PATCH /api/templates/:id
router.patch('/:id', protect, requireCreator, asyncHandler(updateTemplate));

// DELETE /api/templates/:id
router.delete('/:id', protect, asyncHandler(deleteTemplate));

export default router;