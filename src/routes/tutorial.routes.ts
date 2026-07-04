import { Router } from 'express';
import { tutorialController } from '../controllers/tutorial.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { uploadVideo } from '../utils/cloudinary.js';

const router = Router();

// PUBLIC
router.get('/', tutorialController.list);

// ADMIN — static paths first
router.get(
  '/admin/by-status',
  authenticate,
  requireRole('ADMIN'),
  tutorialController.listByStatus,
);

router.get(
  '/admin/tutorials/pending',
  authenticate,
  requireRole('ADMIN'),
  tutorialController.pending,
);

// PUBLIC — after static paths
router.get('/:id', tutorialController.getOne);

// CREATOR — upload video file
router.post(
  '/',
  authenticate,
  requireRole('CREATOR', 'ADMIN'),
  uploadVideo.single('video'),   // multer handles the file
  tutorialController.create,
);

router.patch('/:id/approve',   authenticate, requireRole('ADMIN'), tutorialController.approve);
router.patch('/:id/reject',    authenticate, requireRole('ADMIN'), tutorialController.reject);
router.patch('/:id/unpublish', authenticate, requireRole('ADMIN'), tutorialController.unpublish);
router.delete('/:id/permanent', authenticate, requireRole('ADMIN'), tutorialController.permanentDelete);

export default router;