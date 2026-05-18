/**
 * FLOWVA — Upload Middleware
 *
 * Uses multer.memoryStorage() + cloudinary.uploader.upload_stream()
 * NO multer-storage-cloudinary — avoids the cloudinary v1/v2 peer conflict entirely.
 *
 * Pattern: multer buffers the file in memory → we pipe it to Cloudinary via upload_stream.
 * The Cloudinary secure_url is then available on req.cloudinaryUrls.
 */

import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import type { Request, Response, NextFunction } from 'express';
import { Readable } from 'stream';
import logger from '../utils/logger.js';

// ── Configure Cloudinary ──────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key:    process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
  secure:     true,
});

export { cloudinary };

// ── Extend Express Request ────────────────────────────
declare global {
  namespace Express {
    interface Request {
      cloudinaryUrls?: {
        thumbnailUrl?: string;
        downloadUrl?:  string;
      };
    }
  }
}

// ── Memory storage (no disk writes) ──────────────────
const memStorage = multer.memoryStorage();

// ── File filters ──────────────────────────────────────
function imageFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG or WebP images are allowed for thumbnails'));
  }
}

function templateFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void {
  const allowed = [
    'video/mp4',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
  ];
  if (allowed.includes(file.mimetype) || file.originalname.endsWith('.zip')) {
    cb(null, true);
  } else {
    cb(new Error('Only MP4 video or ZIP files are allowed for templates'));
  }
}

// ── Multer instances (memory only) ───────────────────

// Single thumbnail upload (5 MB max)
export const multerThumbnail = multer({
  storage:    memStorage,
  fileFilter: imageFilter,
  limits:     { fileSize: 5 * 1024 * 1024 },
}).single('thumbnail');

// Single template file upload (50 MB max)
export const multerTemplate = multer({
  storage:    memStorage,
  fileFilter: templateFilter,
  limits:     { fileSize: 50 * 1024 * 1024 },
}).single('file');

// Both fields in one request
export const multerBoth = multer({
  storage: memStorage,
  limits:  { fileSize: 50 * 1024 * 1024 },
}).fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'file',      maxCount: 1 },
]);

// ── Cloudinary upload helper ──────────────────────────
function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

async function uploadToCloudinary(
  buffer: Buffer,
  options: Record<string, unknown>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error || !result) {
        reject(error ?? new Error('Cloudinary upload failed'));
        return;
      }
      resolve(result.secure_url);
    });

    bufferToStream(buffer).pipe(uploadStream);
  });
}

// ── Middleware: push thumbnail to Cloudinary after multer ─
export async function processThumbnail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.file) {
    next();
    return;
  }

  try {
    const url = await uploadToCloudinary(req.file.buffer, {
      folder:       'flowva/thumbnails',
      resource_type:'image',
      transformation: [
        { width: 1280, height: 800, crop: 'fill', quality: 'auto', fetch_format: 'auto' },
      ],
      public_id: `thumb_${Date.now()}`,
    });

    req.cloudinaryUrls = { ...(req.cloudinaryUrls ?? {}), thumbnailUrl: url };
    next();
  } catch (err) {
    logger.error('Thumbnail upload to Cloudinary failed', err);
    res.status(500).json({ success: false, message: 'Image upload failed' });
  }
}

// ── Middleware: push template file to Cloudinary after multer ─
export async function processTemplateFile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.file) {
    next();
    return;
  }

  try {
    const url = await uploadToCloudinary(req.file.buffer, {
      folder:        'flowva/templates',
      resource_type: 'raw',
      public_id:     `file_${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`,
    });

    req.cloudinaryUrls = { ...(req.cloudinaryUrls ?? {}), downloadUrl: url };
    next();
  } catch (err) {
    logger.error('Template file upload to Cloudinary failed', err);
    res.status(500).json({ success: false, message: 'File upload failed' });
  }
}

// ── Middleware: process BOTH fields (for createTemplate route) ─
export async function processBothFiles(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const files = req.files as {
    thumbnail?: Express.Multer.File[];
    file?:      Express.Multer.File[];
  } | undefined;

  if (!files) {
    next();
    return;
  }

  try {
    const uploads: Promise<void>[] = [];

    if (files.thumbnail?.[0]) {
      uploads.push(
        uploadToCloudinary(files.thumbnail[0].buffer, {
          folder:        'flowva/thumbnails',
          resource_type: 'image',
          transformation: [
            { width: 1280, height: 800, crop: 'fill', quality: 'auto', fetch_format: 'auto' },
          ],
          public_id: `thumb_${Date.now()}`,
        }).then(url => {
          req.cloudinaryUrls = { ...(req.cloudinaryUrls ?? {}), thumbnailUrl: url };
        })
      );
    }

    if (files.file?.[0]) {
      uploads.push(
        uploadToCloudinary(files.file[0].buffer, {
          folder:        'flowva/templates',
          resource_type: 'raw',
          public_id:     `file_${Date.now()}_${files.file[0].originalname.replace(/\s+/g, '_')}`,
        }).then(url => {
          req.cloudinaryUrls = { ...(req.cloudinaryUrls ?? {}), downloadUrl: url };
        })
      );
    }

    await Promise.all(uploads);
    next();
  } catch (err) {
    logger.error('Cloudinary upload failed in processBothFiles', err);
    res.status(500).json({ success: false, message: 'File upload failed' });
  }
}