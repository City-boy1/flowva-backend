import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import { jobController } from '../controllers/job.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename:    (_req, file, cb) => cb(null, `logo-${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type'));
  },
}).single('logo');

// Public
router.get('/',    jobController.list);
router.get('/:id', jobController.getOne);

// Auth required
router.post('/',      authenticate, jobController.create);
router.post('/logo',  authenticate, logoUpload, jobController.uploadLogo);
router.delete('/:id', authenticate, jobController.deleteJob);
router.post('/:id/apply',                        authenticate, requireRole('CREATOR'), jobController.apply);
router.get( '/:id/applicants',         authenticate, jobController.getApplicants);
router.post('/:id/applicants/:userId/accept', authenticate, jobController.acceptApplicant);
router.post('/:id/applicants/:userId/reject', authenticate, jobController.rejectApplicant);

export default router;