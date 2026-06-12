/**
 * FLOWVA — admin.routes.ts
 * All routes require ADMIN role (enforced by middleware).
 * Route organisation:
 *   GET  /admin/stats
 *   GET  /admin/users          + PATCH suspend/unsuspend
 *   GET  /admin/commissions    + POST disburse
 *   GET  /admin/templates      + GET pending + approve/reject/unpublish/permanent-delete
 *   GET  /admin/tutorials/pending + approve/reject/unpublish/permanent-delete
 *   GET  /admin/projects/pending  + approve/reject/delete
 *   GET  /admin/disputes           + POST resolve
 *   GET  /admin/stuck-orders       + POST complete/cancel
 *   POST /admin/repair-sales-counts
 *   POST /admin/repair-wallets
 */

import { Router, Request, Response } from 'express';
import { z }                          from 'zod';
import { v2 as cloudinary }           from 'cloudinary';
import multer                         from 'multer';

import prisma                         from '../db/prisma.js';
import { Tutorial }                   from '../db/models.js';
import { Template }                   from '../models/template.model.js';
import { AppError }                   from '../middleware/errorHandler.js';
import { asyncHandler }               from '../middleware/asyncHandler.js';
import { authenticate, requireRole }  from '../middleware/auth.js';
import { emailService }               from '../services/email.service.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Commission rates resolved per-creator */
function resolveRates(creator: { isEarlyAdopter: boolean }) {
  const commissionRate = creator.isEarlyAdopter
    ? parseFloat(process.env.EARLY_ADOPTER_COMMISSION_RATE || '0.10')
    : parseFloat(process.env.PLATFORM_COMMISSION_RATE      || '0.30');
  return { commissionRate, creatorRate: 1 - commissionRate };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Service layer  (pure business logic, no Express objects)
// ─────────────────────────────────────────────────────────────────────────────

const adminService = {

  // ── Overview stats ────────────────────────────────────────────────────────
  async getStats() {
    const [users, creators, completedOrders, revenue, pendingTemplates, pendingTutorials, pendingProjects, pendingRoleRequests] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { role: 'CREATOR' } }),
        prisma.order.count({ where: { status: 'COMPLETED' } }),
        prisma.commission.aggregate({ _sum: { grossAmount: true, commissionAmount: true } }),
        Template.countDocuments({ status: 'PENDING' }),
        Tutorial.countDocuments({ status: 'PENDING' }),
        prisma.project.count({ where: { status: 'PENDING' as any } }),
        prisma.roleRequest.count({ where: { status: 'PENDING' } }),
      ]);
    return {
      users,
      creators,
      completedOrders,
      totalRevenue:     revenue._sum.grossAmount     ?? 0,
      totalCommission:  revenue._sum.commissionAmount ?? 0,
      pendingTemplates,
      pendingTutorials,
      pendingProjects,
      pendingRoleRequests,
    };
  },

  // ── Users ─────────────────────────────────────────────────────────────────
  async getUsers(opts: { role?: string; status?: string; page?: number; limit?: number }) {
    const where: Record<string, string> = {};
    if (opts.role)   where.role   = opts.role;
    if (opts.status) where.status = opts.status;
    const page  = Math.max(1, opts.page  ?? 1);
    const limit = Math.min(opts.limit ?? 20, 100);
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, email: true, role: true, status: true, country: true, isEarlyAdopter: true, createdAt: true },
      }),
      prisma.user.count({ where }),
    ]);
    return { users, total, page, limit };
  },

  async suspendUser(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);
    if (user.role === 'ADMIN') throw new AppError('Cannot suspend an admin account', 403);
    return prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
  },

  async unsuspendUser(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);
    if (user.role === 'ADMIN') throw new AppError('Cannot modify an admin account', 403);
    if (user.status !== 'SUSPENDED') throw new AppError('User is not suspended', 400);
    return prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
  },

  // ── Role Requests ─────────────────────────────────────────
async getRoleRequests(status?: string) {
  const rows = await prisma.roleRequest.findMany({
  where: status ? { status } : {},
  orderBy: { createdAt: 'desc' },
  take: 100,
  select: {
    id:              true,
    userId:          true,
    status:          true,
    portfolio:       true,
    software:        true,
    bio:             true,
    message:         true,
    rejectionReason: true,
    actionedAt:      true,
    createdAt:       true,
    updatedAt:       true,
    user: { select: { id: true, name: true, email: true, role: true, createdAt: true } },
  },
});
  // Sanitise portfolio URL before sending to admin client —
  // only allow https:// links so no javascript:, data:, or http: slips through
  return rows.map(r => ({
    ...r,
    portfolio: (() => {
  try {
    const u = new URL(r.portfolio ?? '');
    const host = u.hostname;
    if (u.protocol !== 'https:') return null;
    if (!host.includes('.')) return null;
    if (host === 'localhost') return null;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/.test(host)) return null;
    const tld = host.split('.').pop();
    if (!tld || tld.length < 2) return null;
    return r.portfolio;
  } catch { return null; }
})(),
  }));
},

async approveRoleRequest(requestId: string) {
  const req = await prisma.roleRequest.findUnique({
    where: { id: requestId },
    include: { user: true },
  });
  if (!req) throw new AppError('Request not found', 404);
  if (req.status !== 'PENDING') throw new AppError('Request already actioned', 400);

  await prisma.$transaction([
    prisma.user.update({ where: { id: req.userId }, data: { role: 'CREATOR' } }),
    prisma.roleRequest.update({ where: { id: requestId }, data: { status: 'APPROVED', actionedAt: new Date() } }),
    prisma.creatorWallet.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId, totalEarned: 0, pending: 0 },
      update: {},
    }),
  ]);

  await emailService.roleChanged(req.user.email, req.user.name ?? 'there', 'BUYER', 'CREATOR').catch(() => {});
  return req;
},

async rejectRoleRequest(requestId: string, reason: string) {
  const req = await prisma.roleRequest.findUnique({
    where: { id: requestId },
    include: { user: true },
  });
  if (!req) throw new AppError('Request not found', 404);
  if (req.status !== 'PENDING') throw new AppError('Request already actioned', 400);

  await prisma.roleRequest.update({
    where: { id: requestId },
    data: { status: 'REJECTED', rejectionReason: reason, actionedAt: new Date() },
  });

  await emailService.roleRequestRejected(req.user.email, req.user.name ?? 'there', reason).catch(() => {});
  return req;
},

async deleteRoleRequest(requestId: string) {
  const req = await prisma.roleRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new AppError('Request not found', 404);
  if (req.status === 'APPROVED') throw new AppError('Cannot delete an approved request', 400);
  await prisma.roleRequest.delete({ where: { id: requestId } });
},

  // ── Commissions ───────────────────────────────────────────────────────────
  async getCommissions(disbursed?: boolean) {
    return prisma.commission.findMany({
      where:   disbursed !== undefined ? { disbursedToAdmin: disbursed } : {},
      orderBy: { createdAt: 'desc' },
      take:    200,
    });
  },

  // ── Templates ─────────────────────────────────────────────────────────────
  async getPendingTemplates() {
    return Template.find({ status: 'PENDING' }).sort({ createdAt: 1 }).lean();
  },

  async getTemplatesByStatus(status: string) {
    return Template.find({ status: status.toUpperCase() }).sort({ createdAt: -1 }).limit(50).lean();
  },

  async approveTemplate(id: string) {
    const template = await Template.findByIdAndUpdate(
      id,
      { status: 'APPROVED', rejectionReason: undefined },
      { new: true },
    );
    if (!template) throw new AppError('Template not found', 404);
    return template;
  },

  async rejectTemplate(id: string, reason: string) {
    const template = await Template.findByIdAndUpdate(
      id,
      { status: 'REJECTED', rejectionReason: reason },
      { new: true },
    );
    if (!template) throw new AppError('Template not found', 404);
    const creator = await prisma.user.findUnique({
      where: { id: template.creatorId },
      select: { email: true, name: true },
    });
    if (creator) {
      await emailService.templateRejected(creator.email, creator.name, template.title, reason).catch(() => {});
    }
    return template;
  },

  async unpublishTemplate(id: string, reason: string) {
    const template = await Template.findByIdAndUpdate(
      id,
      { status: 'PENDING', rejectionReason: reason },
      { new: true },
    );
    if (!template) throw new AppError('Template not found', 404);
    return template;
  },

  async permanentDeleteTemplate(id: string) {
    const template = await Template.findById(id);
    if (!template) throw new AppError('Template not found', 404);
    // Remove Cloudinary assets
    const deleteAsset = async (url: string | null | undefined,
  type: 'image' | 'video' | 'raw' = 'image') => {
      if (!url) return;
      try {
        const matches = url.match(/\/(?:image|video|raw)\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i);
        if (matches?.[1]) await cloudinary.uploader.destroy(matches[1], { resource_type: type });
      } catch { /* non-fatal */ }
    };
    await Promise.all([
      deleteAsset(template.fileUrl,    template.fileType === 'video' ? 'video' : 'raw'),
      deleteAsset(template.previewUrl, 'image'),
    ]);
    await Template.findByIdAndDelete(id);
  },

  // ── Tutorials ─────────────────────────────────────────────────────────────
  async getPendingTutorials() {
    return Tutorial.find({ status: 'PENDING' }).sort({ createdAt: 1 }).lean();
  },

  async getTutorialsByStatus(status: string) {
    return Tutorial.find({ status: status.toUpperCase() }).sort({ createdAt: -1 }).limit(50).lean();
  },

  async approveTutorial(id: string) {
    const t = await Tutorial.findByIdAndUpdate(id, { status: 'APPROVED', rejectionReason: undefined }, { new: true });
    if (!t) throw new AppError('Tutorial not found', 404);
    return t;
  },

  async rejectTutorial(id: string, reason: string) {
    const t = await Tutorial.findByIdAndUpdate(id, { status: 'REJECTED', rejectionReason: reason }, { new: true });
    if (!t) throw new AppError('Tutorial not found', 404);
    return t;
  },

  async unpublishTutorial(id: string, reason: string) {
    const t = await Tutorial.findByIdAndUpdate(id, { status: 'PENDING', rejectionReason: reason }, { new: true });
    if (!t) throw new AppError('Tutorial not found', 404);
    return t;
  },

  async permanentDeleteTutorial(id: string) {
    const t = await Tutorial.findById(id);
    if (!t) throw new AppError('Tutorial not found', 404);
    if (t.videoUrl) {
      try {
        const matches = t.videoUrl.match(/\/video\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i);
        if (matches?.[1]) await cloudinary.uploader.destroy(matches[1], { resource_type: 'video' });
      } catch { /* non-fatal */ }
    }
    await Tutorial.findByIdAndDelete(id);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Router
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate, requireRole('ADMIN'));

// ════════════════════════════════════════════════════════════════════════════
//  OVERVIEW
// ════════════════════════════════════════════════════════════════════════════

router.get('/stats', asyncHandler(async (_req: Request, res: Response) => {
  const stats = await adminService.getStats();
  res.json({ success: true, stats });
}));

// ════════════════════════════════════════════════════════════════════════════
//  USERS
// ════════════════════════════════════════════════════════════════════════════

router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const { role, status, page, limit } = req.query as Record<string, string>;
  const result = await adminService.getUsers({ role, status, page: +page || 1, limit: +limit || 20 });
  res.json({ success: true, ...result });
}));

router.patch('/users/:id/suspend', asyncHandler(async (req: Request, res: Response) => {
  const user = await adminService.suspendUser(req.params.id);
  res.json({ success: true, user });
}));

router.patch('/users/:id/unsuspend', asyncHandler(async (req: Request, res: Response) => {
  const user = await adminService.unsuspendUser(req.params.id);
  res.json({ success: true, user });
}));

router.patch('/users/:id/role', asyncHandler(async (req: Request, res: Response) => {
  const { role } = z.object({ role: z.enum(['BUYER', 'CREATOR']) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new AppError('User not found', 404);
  if (user.role === 'ADMIN') throw new AppError('Cannot modify an admin account', 403);
  const updated = await prisma.user.update({ where: { id: req.params.id }, data: { role } });
  await emailService.roleChanged(
    updated.email,
    updated.name ?? 'there',
    user.role,
    role,
  ).catch(() => {});
  res.json({ success: true, user: updated });
}));

// ════════════════════════════════════════════════════════════════════════════
//  ROLE REQUESTS
// ════════════════════════════════════════════════════════════════════════════

router.get('/role-requests', asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const requests = await adminService.getRoleRequests(status);
  res.json({ success: true, requests });
}));

router.post('/role-requests/:id/approve', asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.approveRoleRequest(req.params.id);
  res.json({ success: true, result });
}));

router.post('/role-requests/:id/reject', asyncHandler(async (req: Request, res: Response) => {
  const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);
  const result = await adminService.rejectRoleRequest(req.params.id, reason);
  res.json({ success: true, result });
}));

router.delete('/role-requests/:id', asyncHandler(async (req: Request, res: Response) => {
  await adminService.deleteRoleRequest(req.params.id);
  res.json({ success: true });
}));

// ════════════════════════════════════════════════════════════════════════════
//  COMMISSIONS
// ════════════════════════════════════════════════════════════════════════════

router.get('/commissions', asyncHandler(async (req: Request, res: Response) => {
  const disbursed =
    req.query.disbursed === 'true'  ? true  :
    req.query.disbursed === 'false' ? false : undefined;
  const commissions = await adminService.getCommissions(disbursed);
  res.json({ success: true, commissions });
}));

router.post('/commissions/:id/disburse', asyncHandler(async (req: Request, res: Response) => {
  const commission = await prisma.commission.findUnique({ where: { id: req.params.id } });
  if (!commission) throw new AppError('Commission not found', 404);
  if (commission.disbursedToAdmin) { res.json({ success: true, message: 'Already disbursed' }); return; }
  await prisma.commission.update({
    where: { id: req.params.id },
    data: { disbursedToAdmin: true, disbursedAt: new Date(), adminPayoutRef: `HELIO_ONCHAIN_${commission.orderId}` },
  });
  res.json({ success: true });
}));

// ════════════════════════════════════════════════════════════════════════════
//  TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

router.get('/templates/pending', asyncHandler(async (_req: Request, res: Response) => {
  const templates = await adminService.getPendingTemplates();
  res.json({ success: true, templates });
}));

router.get('/templates', asyncHandler(async (req: Request, res: Response) => {
  const status = (req.query.status as string) ?? 'PENDING';
  const templates = await adminService.getTemplatesByStatus(status);
  res.json({ success: true, templates });
}));

router.patch('/templates/:id/approve', asyncHandler(async (req: Request, res: Response) => {
  const template = await adminService.approveTemplate(req.params.id);
  res.json({ success: true, template });
}));

router.patch('/templates/:id/reject', asyncHandler(async (req: Request, res: Response) => {
  const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);
  const template = await adminService.rejectTemplate(req.params.id, reason);
  res.json({ success: true, template });
}));

router.patch('/templates/:id/unpublish', asyncHandler(async (req: Request, res: Response) => {
  const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);
  const template = await adminService.unpublishTemplate(req.params.id, reason);
  res.json({ success: true, template });
}));

router.delete('/templates/:id/permanent', asyncHandler(async (req: Request, res: Response) => {
  await adminService.permanentDeleteTemplate(req.params.id);
  res.json({ success: true });
}));

// ════════════════════════════════════════════════════════════════════════════
//  TUTORIALS
// ════════════════════════════════════════════════════════════════════════════

router.get('/tutorials/pending', asyncHandler(async (_req: Request, res: Response) => {
  const tutorials = await adminService.getPendingTutorials();
  res.json({ success: true, tutorials });
}));

router.get('/tutorials/by-status', asyncHandler(async (req: Request, res: Response) => {
  const status = (req.query.status as string) ?? 'PENDING';
  const tutorials = await adminService.getTutorialsByStatus(status);
  res.json({ success: true, tutorials });
}));

router.patch('/tutorials/:id/approve', asyncHandler(async (req: Request, res: Response) => {
  const tutorial = await adminService.approveTutorial(req.params.id);
  res.json({ success: true, tutorial });
}));

router.patch('/tutorials/:id/reject', asyncHandler(async (req: Request, res: Response) => {
  const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);
  const tutorial = await adminService.rejectTutorial(req.params.id, reason);
  res.json({ success: true, tutorial });
}));

router.patch('/tutorials/:id/unpublish', asyncHandler(async (req: Request, res: Response) => {
  const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);
  const tutorial = await adminService.unpublishTutorial(req.params.id, reason);
  res.json({ success: true, tutorial });
}));

router.delete('/tutorials/:id/permanent', asyncHandler(async (req: Request, res: Response) => {
  await adminService.permanentDeleteTutorial(req.params.id);
  res.json({ success: true });
}));

// ════════════════════════════════════════════════════════════════════════════
//  PROJECTS
// ════════════════════════════════════════════════════════════════════════════

router.get('/projects/pending', asyncHandler(async (_req: Request, res: Response) => {
  const projects = await prisma.project.findMany({
    where:   { status: 'PENDING' as any },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { bids: true } } },
  });
  const { ProjectContent } = await import('../db/models.js');
  const contents = await ProjectContent.find({ pgProjectId: { $in: projects.map(p => p.id) } }).lean();
  const contentMap = Object.fromEntries((contents as any[]).map(c => [c.pgProjectId, c]));
  const clients = await prisma.user.findMany({
    where:  { id: { in: projects.map(p => p.clientId) } },
    select: { id: true, name: true, email: true },
  });
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));
  res.json({
    success: true,
    projects: projects.map(p => ({
      ...p,
      content:     contentMap[p.id]               ?? null,
      clientName:  (clientMap[p.clientId] as any)?.name  ?? 'Client',
      clientEmail: (clientMap[p.clientId] as any)?.email ?? '',
    })),
  });
}));

router.patch('/projects/:id/approve', asyncHandler(async (req: Request, res: Response) => {
  const project = await prisma.project.update({ where: { id: req.params.id }, data: { status: 'OPEN' } });
  res.json({ success: true, project });
}));

router.patch('/projects/:id/reject', asyncHandler(async (req: Request, res: Response) => {
  const project = await prisma.project.update({ where: { id: req.params.id }, data: { status: 'DRAFT' as any } });
  res.json({ success: true, project });
}));

router.delete('/projects/:id', asyncHandler(async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { client: { select: { email: true, name: true } } },
  });
  if (!project) throw new AppError('Project not found', 404);
  const { ProjectContent } = await import('../db/models.js');
  await ProjectContent.deleteOne({ pgProjectId: req.params.id });
  await prisma.bid.deleteMany({ where: { projectId: req.params.id } });
  await prisma.project.delete({ where: { id: req.params.id } });
  if (project.client?.email) {
    await emailService.projectDeleted(project.client.email, project.client.name ?? 'there').catch(() => {});
  }
  res.json({ success: true });
}));

// ════════════════════════════════════════════════════════════════════════════
//  DISPUTES
// ════════════════════════════════════════════════════════════════════════════

router.get('/disputes', asyncHandler(async (_req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where:   { status: 'DISPUTED' },
    orderBy: { createdAt: 'desc' },
    include: {
      buyer:   { select: { name: true, email: true } },
      creator: { select: { name: true, email: true } },
    },
  });
  res.json({ success: true, orders });
}));

router.post('/disputes/:orderId/resolve', asyncHandler(async (req: Request, res: Response) => {
  const { decision } = z.object({ decision: z.enum(['REFUND', 'RELEASE']) }).parse(req.body);

  const order = await prisma.order.findUnique({
    where:   { id: req.params.orderId },
    include: { creator: true, buyer: true },
  });
  if (!order || order.status !== 'DISPUTED') throw new AppError('No disputed order found', 404);

  const {creatorRate } = resolveRates(order.creator);
  const creatorEarning = Number((order.amount * creatorRate).toFixed(2));

  if (decision === 'RELEASE') {
    await prisma.$transaction([
      prisma.order.update({ where: { id: order.id }, data: { status: 'COMPLETED', completedAt: new Date() } }),
      prisma.escrow.updateMany({ where: { orderId: order.id }, data: { status: 'RELEASED', releasedAt: new Date() } }),
      prisma.creatorWallet.upsert({
        where:  { userId: order.creatorId },
        create: { userId: order.creatorId, totalEarned: creatorEarning, pending: 0 },
        update: { totalEarned: { increment: creatorEarning }, pending: { decrement: creatorEarning } },
      }),
    ]);
  } else {
    // Actual on-chain refund handled manually via Helio / Phantom
    await prisma.$transaction([
      prisma.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } }),
      prisma.escrow.updateMany({ where: { orderId: order.id }, data: { status: 'REFUNDED', refundedAt: new Date() } }),
    ]);
  }

  res.json({ success: true, decision });
}));

// ════════════════════════════════════════════════════════════════════════════
//  STUCK ORDERS
// ════════════════════════════════════════════════════════════════════════════

router.get('/stuck-orders', asyncHandler(async (_req: Request, res: Response) => {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const orders = await prisma.order.findMany({
    where:   { status: 'PENDING', createdAt: { lt: cutoff } },
    orderBy: { createdAt: 'desc' },
    take:    100,
    include: { buyer: { select: { name: true, email: true } } },
  });
  res.json({ success: true, orders });
}));

router.post('/orders/:id/cancel', asyncHandler(async (req: Request, res: Response) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw new AppError('Order not found', 404);
  if (order.status !== 'PENDING') throw new AppError('Only PENDING orders can be cancelled', 400);
  await prisma.order.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } });
  res.json({ success: true });
}));

router.post('/orders/:id/complete', asyncHandler(async (req: Request, res: Response) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { creator: true } });
  if (!order) throw new AppError('Order not found', 404);
  if (!['PENDING', 'PAID'].includes(order.status)) throw new AppError('Only PENDING or PAID orders can be force-completed', 400);

  const { commissionRate, creatorRate } = resolveRates(order.creator);
  const commissionAmount = Number((order.amount * commissionRate).toFixed(2));
  const creatorEarning   = Number((order.amount * creatorRate).toFixed(2));

  await prisma.$transaction([
    prisma.order.update({ where: { id: order.id }, data: { status: 'COMPLETED', completedAt: new Date() } }),
    prisma.creatorWallet.upsert({
      where:  { userId: order.creatorId },
      create: { userId: order.creatorId, totalEarned: creatorEarning, pending: 0 },
      update: { totalEarned: { increment: creatorEarning } },
    }),
    prisma.commission.upsert({
      where:  { orderId: order.id },
      create: { orderId: order.id, creatorId: order.creatorId, grossAmount: order.amount, commissionRate, commissionAmount, creatorEarning, disbursedToAdmin: true, disbursedAt: new Date() },
      update: {},
    }),
  ]);

  if (order.mongoTemplateId) {
    const { templateService } = await import('../services/template.service.js');
    await templateService.recordPurchase(order.mongoTemplateId).catch(() => {});
  }

  res.json({ success: true });
}));

// ════════════════════════════════════════════════════════════════════════════
//  MAINTENANCE TOOLS
// ════════════════════════════════════════════════════════════════════════════

router.post('/repair-sales-counts', asyncHandler(async (_req: Request, res: Response) => {
  const completedOrders = await prisma.order.findMany({
    where:  { type: 'TEMPLATE_PURCHASE', status: 'COMPLETED', mongoTemplateId: { not: null } },
    select: { mongoTemplateId: true },
  });
  const counts: Record<string, number> = {};
  for (const o of completedOrders) {
    if (o.mongoTemplateId) counts[o.mongoTemplateId] = (counts[o.mongoTemplateId] ?? 0) + 1;
  }
  let templatesUpdated = 0;
  for (const [templateId, count] of Object.entries(counts)) {
    await Template.findByIdAndUpdate(templateId, { salesCount: count, purchaseCount: count });
    templatesUpdated++;
  }
  res.json({ success: true, templatesUpdated });
}));

router.post('/repair-wallets', asyncHandler(async (_req: Request, res: Response) => {
  const creators = await prisma.user.findMany({ where: { role: 'CREATOR' }, select: { id: true } });
  for (const c of creators) {
    await prisma.creatorWallet.upsert({
      where:  { userId: c.id },
      create: { userId: c.id, totalEarned: 0, pending: 0 },
      update: {},
    });
  }
  res.json({ success: true, walletsEnsured: creators.length });
}));

// ════════════════════════════════════════════════════════════════════════════
//  PROJECT ATTACHMENT UPLOAD  (used by admin when editing projects)
// ════════════════════════════════════════════════════════════════════════════

const memStorage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/projects/upload-attachment',
  memStorage.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw new AppError('No file provided', 400);
    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'projects/attachments', resource_type: 'auto' },
        (err, result) => (err ? reject(err) : resolve(result)),
      );
      stream.end(req.file!.buffer);
    });
    res.json({ success: true, url: result.secure_url });
  }),
);

export default router;