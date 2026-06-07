import { Request, Response } from 'express';
import prisma from '../db/prisma.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
export const notificationController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const notifs = await prisma.notification.findMany({
      where:   { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take:    30,
    });
    res.json({ success: true, notifications: notifs });
  }),

  markAllRead: asyncHandler(async (req: Request, res: Response) => {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, read: false },
      data:  { read: true },
    });
    res.json({ success: true });
  }),
};