import { Router } from 'express';
import { templateController } from '../controllers/template.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { downloadRateLimit } from '../middleware/rateLimiter.js';
import { uploadRateLimit, paymentRateLimit, generalRateLimit } from '../middleware/rateLimiter.js';
import multer from 'multer';
import os from 'os';
import path from 'path';

const router = Router();

// Single file only — preview is auto-generated from first frame/page on backend

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
  limits: { fileSize: 70 * 1024 * 1024 }, // hard cap at multer level — anything bigger is rejected before upload completes
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'video/mp4', 'video/webm', 'video/quicktime',
      'image/png', 'image/jpeg', 'image/webp',
      'application/pdf',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type'));
  },
});

router.get('/',    generalRateLimit, templateController.list);
router.get('/:id', generalRateLimit, templateController.getOne);
// Single file upload — preview auto-generated
router.post('/',  authenticate,  requireRole('CREATOR', 'ADMIN'),  uploadRateLimit,  mem.single('file'),  templateController.create,);
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