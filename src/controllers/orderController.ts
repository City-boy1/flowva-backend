import type { Response } from 'express';
import type { AuthRequest } from '../types/index.js';
import prisma from '../db/prisma.js';
import { Template } from '../db/mongoose.js';

// ── GET BUYER'S ORDERS (purchase history) ─────────────
export async function getMyOrders(req: AuthRequest, res: Response): Promise<void> {
  const pgUser = await prisma.user.findUnique({ where: { mongoId: req.user!.id } });

  if (!pgUser) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  const orders = await prisma.order.findMany({
    where:   { buyerId: pgUser.id, status: 'PAID' },
    orderBy: { createdAt: 'desc' },
    select: {
      id:            true,
      templateMongoId: true,
      templateTitle: true,
      amountTotal:   true,
      downloadUrl:   true,
      createdAt:     true,
    },
  });

  res.json({ success: true, data: orders });
}

// ── GET SECURE DOWNLOAD LINK ──────────────────────────
// Verifies the requesting user actually bought this template
export async function getDownloadLink(req: AuthRequest, res: Response): Promise<void> {
  const { templateId } = req.params;

  const pgUser = await prisma.user.findUnique({ where: { mongoId: req.user!.id } });

  if (!pgUser) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  // Confirm they own this purchase
  const order = await prisma.order.findFirst({
    where: {
      buyerId:         pgUser.id,
      templateMongoId: templateId,
      status:          'PAID',
    },
    select: { downloadUrl: true },
  });

  if (!order) {
    res.status(403).json({ success: false, message: 'Purchase not found. Please buy this template first.' });
    return;
  }

  if (!order.downloadUrl) {
    res.status(404).json({ success: false, message: 'Download link not yet available' });
    return;
  }

  res.json({ success: true, data: { downloadUrl: order.downloadUrl } });
}

// ── CHECK IF USER OWNS A TEMPLATE ────────────────────
export async function checkOwnership(req: AuthRequest, res: Response): Promise<void> {
  const { templateId } = req.params;

  const pgUser = await prisma.user.findUnique({ where: { mongoId: req.user!.id } });

  const owned = pgUser
    ? await prisma.order.findFirst({
        where: { buyerId: pgUser.id, templateMongoId: templateId, status: 'PAID' },
        select: { id: true },
      })
    : null;

  res.json({ success: true, data: { owned: !!owned } });
}