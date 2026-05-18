import { Router } from 'express';
import { getMyOrders, getDownloadLink, checkOwnership } from '../controllers/orderController.js';
import { protect } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(protect);

// GET  /api/orders          — buyer's purchase history
router.get('/', asyncHandler(getMyOrders));

// GET  /api/orders/download/:templateId — secure download link
router.get('/download/:templateId', asyncHandler(getDownloadLink));

// GET  /api/orders/owns/:templateId — check if user owns a template
router.get('/owns/:templateId', asyncHandler(checkOwnership));

export default router;