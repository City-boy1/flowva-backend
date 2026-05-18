import type { Response } from 'express';
import type { AuthRequest } from '../types/index.js';
import prisma from '../db/prisma.js';
import { Template, User, Notification } from '../db/mongoose.js';

// ── CREATOR OVERVIEW ──────────────────────────────────
export async function getOverview(req: AuthRequest, res: Response): Promise<void> {
  const mongoId = req.user!.id;

  const pgUser = await prisma.user.findUnique({ where: { mongoId } });

  const [mongoUser, templateCount, recentOrders] = await Promise.all([
    User.findById(mongoId).select('totalSales totalRevenue'),
    Template.countDocuments({ creator: mongoId, isPublished: true }),
    pgUser
      ? prisma.order.findMany({
          where:   { creatorId: pgUser.id, status: 'PAID' },
          orderBy: { createdAt: 'desc' },
          take:    10,
          select:  {
            id:            true,
            templateTitle: true,
            amountTotal:   true,
            creatorAmount: true,
            createdAt:     true,
          },
        })
      : [],
  ]);

  // Monthly revenue for chart (last 7 months)
  const now   = new Date();
  const months = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (6 - i), 1);
    return {
      label: d.toLocaleString('default', { month: 'short' }),
      year:  d.getFullYear(),
      month: d.getMonth() + 1,
    };
  });

  const monthlyRevenue = pgUser
    ? await Promise.all(months.map(async m => {
        const result = await prisma.order.aggregate({
          where: {
            creatorId: pgUser.id,
            status:    'PAID',
            createdAt: {
              gte: new Date(m.year, m.month - 1, 1),
              lt:  new Date(m.year, m.month,     1),
            },
          },
          _sum: { creatorAmount: true },
        });
        return { label: m.label, value: (result._sum.creatorAmount ?? 0) / 100 };
      }))
    : months.map(m => ({ label: m.label, value: 0 }));

  res.json({
    success: true,
    data: {
      totalRevenue:    mongoUser?.totalRevenue   ?? 0,
      totalSales:      mongoUser?.totalSales     ?? 0,
      totalTemplates:  templateCount,
      recentOrders,
      monthlyRevenue,
    },
  });
}

// ── GET NOTIFICATIONS ─────────────────────────────────
export async function getNotifications(req: AuthRequest, res: Response): Promise<void> {
  const notifications = await Notification.find({ userId: req.user!.id })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  res.json({ success: true, data: notifications });
}

// ── MARK NOTIFICATIONS READ ───────────────────────────
export async function markNotificationsRead(req: AuthRequest, res: Response): Promise<void> {
  await Notification.updateMany({ userId: req.user!.id, read: false }, { $set: { read: true } });
  res.json({ success: true, message: 'Notifications marked as read' });
}

// ── GET USER PROFILE ──────────────────────────────────
export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.user!.id);
  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }
  res.json({ success: true, data: user });
}

// ── UPDATE PROFILE ────────────────────────────────────
export async function updateProfile(req: AuthRequest, res: Response): Promise<void> {
  const allowed = ['name', 'bio', 'tags'];
  const updates: Record<string, unknown> = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const user = await User.findByIdAndUpdate(req.user!.id, updates, { new: true });
  res.json({ success: true, data: user });
}