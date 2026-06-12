import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Request } from 'express';
import { AppError } from '../middleware/errorHandler.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

export { cloudinary };

// Images stay in memory — they're small
export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: Request, file, cb) => {
    if (['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new AppError('Image files only (jpeg, png, gif, webp)', 400));
  },
});

// Templates go to disk — keeps RAM free on the free tier
export const uploadTemplate = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.bin';
      cb(null, `tmpl-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req: Request, file, cb) => {
    const allowed = [
      'application/zip', 'application/x-zip-compressed',
      'video/mp4', 'video/quicktime', 'video/x-msvideo',
      'video/webm', 'image/png', 'image/jpeg', 'image/webp',
      'application/pdf', 'application/octet-stream',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new AppError('Unsupported file type', 400));
  },
});

export const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.mp4';
      cb(null, `tut-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req: Request, file, cb) => {
    const allowed = ['video/mp4','video/quicktime','video/x-msvideo','video/webm'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new AppError('Video files only', 400));
  },
});

// Streams from a Buffer or a file path, with a 90s timeout
export async function uploadToCloudinary(
  source: Buffer | string,   // Buffer for images, file path for video/zip
  folder: string,
  options: Record<string, any> = {},
): Promise<{ url: string; publicId: string; eager?: any[] }> {
  const TIMEOUT_MS = typeof source === 'string' ? 660_000 : 60_000; // 60s for image buffers, 11min for video files
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AppError('Cloudinary upload timed out. Try a smaller file.', 504)),
      TIMEOUT_MS,
    );

    const done = (error: any, result: any) => {
      clearTimeout(timer);
      if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
      resolve({ url: result.secure_url, publicId: result.public_id, eager: result.eager });
    };

    if (typeof source === 'string') {
      // File path → use upload() which reads the file stream itself
      cloudinary.uploader.upload(source, {
        folder:     `flowva/${folder}`,
        chunk_size: 6_000_000,
        timeout:    660_000,
        ...options,
      }, done);
    } else {
      // Buffer → upload_stream (images, avatars, small PDFs)
      cloudinary.uploader.upload_stream({ folder: `flowva/${folder}`, ...options }, done).end(source);
    }
  });
}

export async function deleteFromCloudinary(
  publicId: string,
  resourceType: 'image' | 'video' | 'raw' = 'image',
): Promise<void> {
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}



/**
 * Streams a file from disk to Cloudinary without loading it into memory.
 * Use this for video and zip uploads only.
 */
export function uploadToCloudinaryStream(
  filePath: string,
  folder: string,
  options: Record<string, any> = {},
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder:     `flowva/${folder}`,
        chunk_size: 6_000_000,
        timeout:    660_000,
        ...options,
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );

    fs.createReadStream(filePath)
      .on('error', reject)
      .pipe(uploadStream);
  });
}