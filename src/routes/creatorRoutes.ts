import { Router } from 'express';
import { getCreators, getCreatorProfile } from '../controllers/creatorController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// GET /api/creators          — public creator listing
router.get('/', asyncHandler(getCreators));

// GET /api/creators/:id      — single creator profile + their templates
router.get('/:id', asyncHandler(getCreatorProfile));

export default router;