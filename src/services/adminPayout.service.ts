import prisma from '../db/prisma.js';
import logger from '../utils/logger.js';

// All commissions are auto-disbursed on-chain by Helio the moment a buyer pays
// This service exists only to mark any edge-case commissions as confirmed
export const adminPayoutService = {
  async confirmOnChain(orderId: string) {
    const commission = await prisma.commission.findUnique({ where: { orderId } });
    if (!commission || commission.disbursedToAdmin) return;

    await prisma.commission.update({
      where: { orderId },
      data: {
        disbursedToAdmin: true,
        disbursedAt:      new Date(),
        adminPayoutRef:   `HELIO_ONCHAIN_${orderId}`,
      },
    });

    logger.info('Admin commission confirmed on-chain', { orderId });
  },
};