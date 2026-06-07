import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export const payoutService = {

  // Dashboard wallet — display only (totalEarned + pending from active projects)
  async getWallet(userId: string) {
    return prisma.creatorWallet.upsert({
      where:  { userId },
      create: { userId, totalEarned: 0, pending: 0 },
      update: {},
    });
  },

  // Creator's saved Solana wallet address + payout settings
  async getSettings(userId: string) {
    const s = await prisma.payoutSetting.findUnique({ where: { userId } });
    if (!s) throw new AppError('Payout settings not configured', 404);
    return s;
  },

  // Creator updates their wallet address from dashboard
  async updateWalletAddress(userId: string, solanaAddress: string) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaAddress)) {
      throw new AppError('Invalid Solana wallet address', 400);
    }
    return prisma.payoutSetting.upsert({
      where:  { userId },
      create: { userId, primaryMethod: 'USDC_WALLET', solanaAddress, isVerified: true },
      update: { solanaAddress, isVerified: true },
    });
  },

  // Transaction history (from Commission records — real source of truth)
  async getEarningsHistory(userId: string) {
    return prisma.commission.findMany({
      where:   { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      take:    50,
      include: {
        order: {
          select: {
            id:              true,
            type:            true,
            amount:          true,
            currency:        true,
            status:          true,
            completedAt:     true,
            mongoTemplateId: true,
          },
        },
      },
    });
  },
};