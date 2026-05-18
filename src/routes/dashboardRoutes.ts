import { Router } from 'express';
import {
  getOverview,
  getNotifications,
  markNotificationsRead,
  getProfile,
  updateProfile,
} from '../controllers/dashboardController.js';
import { protect } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(protect);

// GET  /api/dashboard/overview
router.get('/overview', asyncHandler(getOverview));

// GET  /api/dashboard/notifications
router.get('/notifications', asyncHandler(getNotifications));

// PATCH /api/dashboard/notifications/read
router.patch('/notifications/read', asyncHandler(markNotificationsRead));

// GET  /api/dashboard/profile
router.get('/profile', asyncHandler(getProfile));

// PATCH /api/dashboard/profile
router.patch('/profile', asyncHandler(updateProfile));

export default router;