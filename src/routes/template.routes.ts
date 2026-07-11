import { Router } from 'express';
import { templateController } from '../controllers/template.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { downloadRateLimit } from '../middleware/rateLimiter.js';
import { uploadRateLimit, paymentRateLimit, generalRateLimit } from '../middleware/rateLimiter.js';
import multer from 'multer';
import os from 'os';
import path from 'path';

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const safe = Date.now() + '-' + Math.random().toString(36).slice(2);
    cb(null, safe + ext);
  },
});

// Images/PDFs under 10 MB stay in memory; large files go to disk
const mem = multer({
  storage,
  limits: { fileSize: 70 * 1024 * 1024 }, // hard cap at multer level
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'thumbnail') {
      const allowed = ['image/png', 'image/jpeg', 'image/webp'];
      return allowed.includes(file.mimetype)
        ? cb(null, true)
        : cb(new Error('Thumbnail must be JPEG, PNG, or WebP'));
    }
    if (file.fieldname === 'preview') {
      const allowed = ['video/mp4', 'video/webm', 'video/quicktime'];
      return allowed.includes(file.mimetype)
        ? cb(null, true)
        : cb(new Error('Preview video must be MP4, WebM, or MOV'));
    }
    // Main template file — resolveFileType() in the service is the
    // authoritative check. NOTE: design-tool formats (PSD/AI/BLEND/FBX,
    // everything the upload wizard's category picker offers beyond
    // video/image/pdf) aren't handled by resolveFileType() yet — that's
    // a pre-existing gap, unrelated to this pricing change, flagged here
    // since it will otherwise reject most non-video/image/pdf uploads.
    cb(null, true);
  },
});

router.get('/',    generalRateLimit, templateController.list);
router.get('/:id', generalRateLimit, templateController.getOne);
router.post(
  '/',
  authenticate,
  requireRole('CREATOR', 'ADMIN'),
  uploadRateLimit,
  mem.fields([
    { name: 'file',      maxCount: 1 }, // the template file itself
    { name: 'thumbnail', maxCount: 1 }, // required
    { name: 'preview',   maxCount: 1 }, // optional
  ]),
  templateController.create,
);
router.put('/:id',    authenticate, requireRole('CREATOR', 'ADMIN'), templateController.update);
router.delete('/:id', authenticate, requireRole('CREATOR', 'ADMIN'), templateController.delete);
router.patch('/:id/approve',    authenticate, requireRole('ADMIN'), templateController.approve);
router.patch('/:id/reject',     authenticate, requireRole('ADMIN'), templateController.reject);
router.patch('/:id/unpublish',  authenticate, requireRole('ADMIN'), templateController.unpublish);
router.delete('/:id/permanent', authenticate, requireRole('ADMIN'), templateController.permanentDelete);
router.post('/:id/purchase',    authenticate, paymentRateLimit,     templateController.purchase);
router.get('/:id/download-token', authenticate, templateController.generateDownloadToken);
router.post('/:id/rate',    authenticate, templateController.rateTemplate);
router.get('/:id/ratings',  templateController.getTemplateRatings);
router.get('/:id/download', templateController.downloadWithToken);
router.get('/:id/download', downloadRateLimit, templateController.downloadWithToken);
export default router;