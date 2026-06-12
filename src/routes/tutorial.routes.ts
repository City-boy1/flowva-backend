import { Router } from 'express';
import { tutorialController } from '../controllers/tutorial.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { uploadRateLimit } from '../middleware/rateLimiter.js';
import multer from 'multer';
import os from 'os';
import path from 'path';

const router = Router();

const tutorialStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname) || '.bin';
    const safe = `tut-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, safe + ext);
  },
});

const tutorialUpload = multer({
  storage: tutorialStorage,
  limits: { fileSize: 70 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'video') {
      const allowed = ['video/mp4', 'video/webm', 'video/quicktime'];
      if (allowed.includes(file.mimetype)) return cb(null, true);
      return cb(new Error('Video must be MP4, WebM, or MOV'));
    }
    if (file.fieldname === 'thumbnail') {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (allowed.includes(file.mimetype)) return cb(null, true);
      return cb(new Error('Thumbnail must be JPG, PNG, or WebP'));
    }
    cb(new Error('Unexpected field'));
  },
}).fields([
  { name: 'video',     maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

// PUBLIC
router.get('/', tutorialController.list);

// ADMIN ROUTES — must come before /:id
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

// PUBLIC — after all static paths
router.get('/:id', tutorialController.getOne);

// CREATOR
router.post(
  '/',
  authenticate,
  requireRole('CREATOR', 'ADMIN'),
  uploadRateLimit,
  tutorialUpload,
  tutorialController.create,
);

router.patch(
  '/:id/approve',
  authenticate,
  requireRole('ADMIN'),
  tutorialController.approve,
);

router.patch(
  '/:id/reject',
  authenticate,
  requireRole('ADMIN'),
  tutorialController.reject,
);

router.patch(
  '/:id/unpublish',
  authenticate,
  requireRole('ADMIN'),
  tutorialController.unpublish,
);

router.delete(
  '/:id/permanent',
  authenticate,
  requireRole('ADMIN'),
  tutorialController.permanentDelete,
);
export default router;