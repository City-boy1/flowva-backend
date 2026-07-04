// TO:
import { Router } from 'express';
import { projectController } from '../controllers/project.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import type { Request, Response } from 'express';

const router = Router();

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/upload-attachment', authenticate, memUpload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError('No file provided', 400);
  const result = await new Promise<any>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'projects/attachments', resource_type: 'auto' },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(req.file!.buffer);
  });
  res.json({ success: true, url: result.secure_url });
}));

router.post('/fund-escrow', authenticate, projectController.fundEscrow);
router.get('/', projectController.list);
router.get('/:id', projectController.getOne);
router.post('/', authenticate, projectController.create);
router.get('/:id/bids', authenticate, projectController.getBids);
router.post('/:id/bids', authenticate, requireRole('CREATOR'), projectController.submitBid);
router.post('/:id/bids/:bidId/accept', authenticate, projectController.acceptBid);
router.post('/:id/bids/:bidId/reject', authenticate, projectController.rejectBid);
router.delete('/:id/bids/:bidId', authenticate, requireRole('CREATOR'), projectController.withdrawBid);
router.patch('/:id/approve', authenticate, requireRole('ADMIN'), projectController.approve);
router.post('/:id/deliver', authenticate, requireRole('CREATOR'), projectController.deliver);
router.post('/:id/approve-delivery', authenticate, projectController.approveDelivery);
router.post('/:id/revision', authenticate, projectController.requestRevision);
router.post('/:id/dispute', authenticate, projectController.openDispute);

export default router;