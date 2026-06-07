import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { userService } from '../services/user.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { uploadRateLimit } from '../middleware/rateLimiter.js';
import multer from 'multer';
import prisma from '../db/prisma.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { notificationController } from '../controllers/notification.controller.js';


const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new AppError('Image files only', 400));
  },
});

const userController = {
  updateProfile: asyncHandler(async (req: Request, res: Response) => {
    const data = z.object({
      name: z.string().min(2).max(80).optional(),
      bio: z.string().max(500).optional(),
      country: z.string().optional(),
    }).parse(req.body);
    const user = await userService.updateProfile(req.user!.id, data);
    res.json({ success: true, user });
  }),

  uploadAvatar: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw new AppError('Image file required', 400);
    const result = await userService.uploadAvatar(req.user!.id, req.file.buffer);
    res.json({ success: true, ...result });
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(6),
    }).parse(req.body);
    await userService.changePassword(req.user!.id, currentPassword, newPassword);
    res.json({ success: true });
  }),

  getOrders: asyncHandler(async (req: Request, res: Response) => {
   const raw = await userService.getOrders(req.user!.id, req.user!.role);
    const orders = raw.map((o: any) => ({ ...o, rated: !!o.rating, rating: undefined }));
    res.json({ success: true, orders });
  }),

  deleteAccount: asyncHandler(async (req: Request, res: Response) => {
    const { password } = z.object({ password: z.string().min(1) }).parse(req.body);
    await userService.deleteAccount(req.user!.id, password);
    res.clearCookie('refreshToken', { path: '/', httpOnly: true });
    res.json({ success: true });
  }),

  getCreators: asyncHandler(async (req: Request, res: Response) => {
    const { page = '1', limit = '20', search } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));

    const where: any = { role: 'CREATOR', status: 'ACTIVE' };
    if (search?.trim()) {
      where.OR = [
        { name:    { contains: search.trim(), mode: 'insensitive' } },
        { bio:     { contains: search.trim(), mode: 'insensitive' } },
        { country: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [creators, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, bio: true, country: true,
          avatarUrl: true, isEarlyAdopter: true, createdAt: true,
          _count: { select: { ratingsReceived: true } },
          ratingsReceived: { select: { score: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.user.count({ where }),
    ]);

    const followerCounts = await prisma.follow.groupBy({
      by: ['followingId'],
      where: { followingId: { in: creators.map(c => c.id) } },
      _count: { followingId: true },
    });
    const followerMap = Object.fromEntries(
      followerCounts.map(f => [f.followingId, f._count.followingId])
    );
    const { Template } = await import('../models/template.model.js');

const templateCounts = await Template.aggregate([
  { $match: { creatorId: { $in: creators.map(c => c.id) }, status: 'APPROVED' } },
  { $group: { _id: '$creatorId', count: { $sum: 1 } } },
]);
const templateCountMap = Object.fromEntries(templateCounts.map(t => [t._id, t.count]));

    const enriched = creators.map((c) => ({
      ...c,
      followerCount: followerMap[c.id] ?? 0,
      totalTemplates: templateCountMap[c.id] ?? 0,
      ratingCount: c._count.ratingsReceived,
      averageRating: c.ratingsReceived.length
        ? +(c.ratingsReceived.reduce((s, r) => s + r.score, 0) / c.ratingsReceived.length).toFixed(1)
        : 0,
      ratingsReceived: undefined,
      _count: undefined,
    }));

    res.json({ success: true, creators: enriched, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  }),

  getCreatorById: asyncHandler(async (req: Request, res: Response) => {
    const viewerId = (req as any).user?.id as string | undefined;

    const creator = await prisma.user.findFirst({
      where: { id: req.params.id, role: 'CREATOR', status: 'ACTIVE' },
      select: {
        id: true, name: true, bio: true, country: true,
        avatarUrl: true, isEarlyAdopter: true, createdAt: true,
        _count: { select: { followers: true, following: true, ratingsReceived: true } },
        ratingsReceived: { select: { score: true, review: true, createdAt: true, rater: { select: { name: true, avatarUrl: true } } } },
        followers: viewerId ? { where: { followerId: viewerId }, select: { id: true } } : false,
      },
    });

    if (!creator) throw new AppError('Creator not found', 404);

    const avgRating = creator.ratingsReceived.length
      ? +(creator.ratingsReceived.reduce((s, r) => s + r.score, 0) / creator.ratingsReceived.length).toFixed(1)
      : 0;

    const followerCount = await prisma.follow.count({ where: { followingId: req.params.id } });
    const isFollowedByViewer = viewerId
      ? await prisma.follow.count({ where: { followerId: viewerId, followingId: req.params.id } }) > 0
      : false;

    res.json({
      success: true,
      creator: {
        ...creator,
        followerCount,
        followingCount: creator._count.following,
        ratingCount:    creator._count.ratingsReceived,
        averageRating:  avgRating,
        isFollowedByViewer,
        followers:      undefined,
        _count:         undefined,
      },
    });
  }),

  // Follow / unfollow
  toggleFollow: asyncHandler(async (req: Request, res: Response) => {
    const followerId  = req.user!.id;
    const followingId = req.params.id;

    if (followerId === followingId) throw new AppError('You cannot follow yourself', 400);

    const target = await prisma.user.findFirst({ where: { id: followingId, role: 'CREATOR' } });
    if (!target) throw new AppError('Creator not found', 404);

    const existing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId } },
    });

    if (existing) {
      await prisma.follow.delete({ where: { id: existing.id } });
    } else {
      await prisma.follow.create({ data: { followerId, followingId } });
    }
    const newCount = await prisma.follow.count({ where: { followingId } });
    res.json({ success: true, following: !existing, followerCount: newCount });
  }),

  // Get who the current user follows
  getFollowing: asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const follows = await prisma.follow.findMany({
    where: { followerId: userId },
    include: {
      following: {
        select: {
          id: true, name: true, bio: true, avatarUrl: true,
          country: true, isEarlyAdopter: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const followingIds = follows.map(f => f.following.id);

  const followerCounts = await prisma.follow.groupBy({
    by: ['followingId'],
    where: { followingId: { in: followingIds } },
    _count: { followingId: true },
  });

  const countMap = Object.fromEntries(
    followerCounts.map(f => [f.followingId, f._count.followingId])
  );

  res.json({
    success: true,
    following: follows.map(f => ({
      ...f.following,
      followerCount: countMap[f.following.id] ?? 0,
    })),
  });
}),

  // Rate a creator after a completed order
  rateCreator: asyncHandler(async (req: Request, res: Response) => {
    const { score, review, orderId } = z.object({
      score:   z.number().int().min(1).max(5),
      review:  z.string().max(500).optional(),
      orderId: z.string(),
    }).parse(req.body);

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('Order not found', 404);
    if (order.buyerId !== req.user!.id) throw new AppError('Not your order', 403);
    if (!['PAID', 'COMPLETED'].includes(order.status)) throw new AppError('Purchase required to rate', 400);

    const existing = await prisma.rating.findUnique({ where: { orderId } });
    if (existing) throw new AppError('You already rated this creator', 409);

    await prisma.rating.create({
      data: { raterId: req.user!.id, creatorId: order.creatorId, orderId, score, review },
    });

    res.status(201).json({ success: true });
  }),

  getFavourites: asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const favs = await prisma.favourite.findMany({
    where: { userId: req.user!.id },
    select: { templateId: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, favourites: favs.map(f => f.templateId) });
}),

addFavourite: asyncHandler(async (req: Request, res: Response) => {
  const { templateId } = z.object({ templateId: z.string() }).parse(req.body);
  await prisma.favourite.upsert({
    where: { userId_templateId: { userId: req.user!.id, templateId } },
    create: { userId: req.user!.id, templateId },
    update: {},
  });
  res.json({ success: true });
}),

removeFavourite: asyncHandler(async (req: Request, res: Response) => {
  await prisma.favourite.deleteMany({
    where: { userId: req.user!.id, templateId: req.params.id },
  });
  res.json({ success: true });
}),

  getPreferences: asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');   // ← add this line
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { emailNotif: true, marketing: true, publicProfile: true },
  });
  res.json({ success: true, preferences: user });
}),

savePreferences: asyncHandler(async (req: Request, res: Response) => {
  const data = z.object({
    emailNotif:    z.boolean().optional(),
    marketing:     z.boolean().optional(),
    publicProfile: z.boolean().optional(),
  }).parse(req.body);
  await prisma.user.update({ where: { id: req.user!.id }, data });
  res.json({ success: true });
}),

  replyToRating: asyncHandler(async (req: Request, res: Response) => {
  const { reply } = z.object({ reply: z.string().min(1).max(500) }).parse(req.body);
  const rating = await prisma.rating.findUnique({ where: { id: req.params.id } });
  if (!rating) throw new AppError('Rating not found', 404);
  if (rating.creatorId !== req.user!.id) throw new AppError('Forbidden', 403);
  await prisma.rating.update({ where: { id: req.params.id }, data: { reply } });
  res.json({ success: true });
}),
  // Get ratings for a creator
  getCreatorRatings: asyncHandler(async (req: Request, res: Response) => {
    const ratings = await prisma.rating.findMany({
      where: { creatorId: req.params.id },
      include: { rater: { select: { name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, ratings });
  }),
};

function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice(7));
      (req as any).user = { id: payload.sub, email: payload.email, role: payload.role };
    } catch {}
  }
  next();
}
const router = Router();

// Public
router.get('/creators',              userController.getCreators);
router.get('/creators/:id', optionalAuth, userController.getCreatorById);
router.get('/creators/:id/ratings',  userController.getCreatorRatings);

// Protected
router.use(authenticate);
router.put('/profile',               userController.updateProfile);
router.post('/avatar',               uploadRateLimit, avatarUpload.single('avatar'), userController.uploadAvatar);
router.post('/change-password',      userController.changePassword);
router.get('/orders',                userController.getOrders);
router.delete('/account',            userController.deleteAccount);
router.post('/creators/:id/follow',  userController.toggleFollow);
router.get('/following',             userController.getFollowing);
router.post('/rate',                 userController.rateCreator);
router.post('/ratings/:id/reply', authenticate, userController.replyToRating);
router.get('/preferences',  userController.getPreferences);
router.put('/preferences',  userController.savePreferences);

router.get('/notifications',        notificationController.list);
router.patch('/notifications/read', notificationController.markAllRead);
router.get('/favourites',        userController.getFavourites);
router.post('/favourites',       userController.addFavourite);
router.delete('/favourites/:id', userController.removeFavourite);

export default router;