import argon2 from 'argon2';
import prisma from '../db/prisma.js';
import { uploadToCloudinary } from '../utils/cloudinary.js';
import { AppError } from '../middleware/errorHandler.js';

export const userService = {
  async updateProfile(userId: string, data: { name?: string; bio?: string; country?: string }) {
    return prisma.user.update({
      where: { id: userId },
      data: { name: data.name, bio: data.bio, country: data.country },
      select: { id: true, name: true, email: true, bio: true, country: true, role: true, avatarUrl: true },
    });
  },

  async uploadAvatar(userId: string, buffer: Buffer) {
    // Use consistent public_id per user so it always overwrites
    const { url } = await uploadToCloudinary(buffer, 'avatars', {
      resource_type: 'image',
      public_id: `avatar_${userId}`,   // same ID every time = overwrites old file
      overwrite: true,
      invalidate: true,                 // clears Cloudinary CDN cache
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
    });

    return prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: url },
      select: { avatarUrl: true },
    });
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);
    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) throw new AppError('Current password is incorrect', 400);
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      prisma.refreshToken.updateMany({ where: { userId }, data: { revoked: true } }),
    ]);
  },

  async getOrders(userId: string, role: string) {
    if (role === 'BUYER' || role === 'ADMIN') {
      const orders = await prisma.order.findMany({
        where: { buyerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          type: true,
          amount: true,
          currency: true,
          status: true,
          mongoTemplateId: true,
          mongoBidId: true,
          creatorId: true,
          createdAt: true,
          rating: { select: { id: true } },
        },
      });
      return orders.map(o => ({ ...o, rated: !!o.rating, rating: undefined }));
    }

    const orders = await prisma.order.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, type: true, amount: true, currency: true,
        status: true, mongoTemplateId: true, mongoBidId: true,
        buyerId: true, createdAt: true,
        buyer: { select: { name: true } },
      },
    });

    const { Template } = await import('../models/template.model.js');
    const templateIds = orders.filter(o => o.mongoTemplateId).map(o => o.mongoTemplateId!);
    const templates = templateIds.length
      ? await Template.find({ _id: { $in: templateIds } }).select('title').lean()
      : [];
    const templateMap = Object.fromEntries(templates.map((t: any) => [String(t._id), t.title]));

    return orders.map(o => ({
      ...o,
      templateTitle: o.mongoTemplateId ? (templateMap[o.mongoTemplateId] ?? 'Template') : null,
      buyerName: o.buyer?.name ?? 'Buyer',
      buyer: undefined,
    }));
  },

  async deleteAccount(userId: string, password: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) throw new AppError('Incorrect password', 400);

    // NOTE: Helio splits earnings on-chain instantly at checkout — creators
    // already hold their USDC in their own exchange wallet. We check pending
    // here as a safety guard for any project escrow not yet released.
    const wallet = await prisma.creatorWallet.findUnique({ where: { userId } });
    if (wallet && wallet.pending > 0) {
      throw new AppError('You have pending earnings from active projects. Please wait for them to complete before deleting your account', 400);
    }

    const activeOrders = await prisma.order.count({
      where: {
        OR: [{ buyerId: userId }, { creatorId: userId }],
        status: { in: ['PAID', 'IN_PROGRESS', 'DELIVERED', 'REVISION_REQUESTED', 'DISPUTED'] },
      },
    });
    if (activeOrders > 0) {
      throw new AppError('You have active orders. Please complete or cancel them before deleting your account', 400);
    }

    // Cascade delete — schema handles RefreshToken, PayoutSetting, CreatorWallet via onDelete: Cascade
    await prisma.user.delete({ where: { id: userId } });
  },
};