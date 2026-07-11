import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { paystackClient } from '../utils/paystack.client.js';
import { PAYSTACK_PAYOUT_COUNTRIES } from '../config/payments.config.js';
import { emailService } from './email.service.js';

const MIN_REASON_LENGTH = 20;

type PayoutMethodInput =
  | { method: 'PAYSTACK_SUBACCOUNT'; bankCode: string; accountNumber: string; currency: string }
  | { method: 'SKRILL'; email: string }
  | { method: 'GREY'; accountNumber: string; accountName: string };

export const payoutService = {

  async getWallet(userId: string) {
    return prisma.creatorWallet.upsert({
      where: { userId }, create: { userId, totalEarned: 0, pending: 0 }, update: {},
    });
  },

  async getSettings(userId: string) {
    return prisma.payoutSetting.upsert({ where: { userId }, create: { userId }, update: {} });
  },

  async setPayoutFrequency(userId: string, frequency: 'WEEKLY' | 'MONTHLY') {
    return prisma.payoutSetting.upsert({
      where: { userId }, create: { userId, payoutFrequency: frequency }, update: { payoutFrequency: frequency },
    });
  },

  /**
   * Single entry point for setting up or changing a creator's payout
   * method. Flowva only supports one active payout wallet per creator at
   * a time — this is a deliberate fraud control: without it, a
   * compromised account could silently add a new destination and redirect
   * a creator's earnings without the creator noticing.
   *
   * - No existing method set (first-time setup): applies immediately.
   * - An existing method is already set: requires a written `reason`
   *   (min 20 characters) and creates a PENDING PayoutChangeRequest for
   *   admin review instead of changing anything right away.
   */
  async requestPayoutMethodChange(userId: string, input: PayoutMethodInput, reason?: string) {
    const settings = await prisma.payoutSetting.findUnique({ where: { userId } });
    const hasExistingMethod = !!settings?.primaryMethod;

    if (!hasExistingMethod) {
      return applyPayoutMethod(userId, input);
    }

    if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
      throw new AppError(
        `Changing your payout method requires a written reason (at least ${MIN_REASON_LENGTH} characters) for admin review.`,
        400,
      );
    }

    const pending = await prisma.payoutChangeRequest.findFirst({ where: { userId, status: 'PENDING' } });
    if (pending) {
      throw new AppError('You already have a payout change request awaiting admin review.', 409);
    }

    return prisma.payoutChangeRequest.create({
      data: {
        userId,
        requestedMethod:  input.method,
        requestedDetails: input as unknown as object,
        reason:           reason.trim(),
      },
    });
  },

  async listPaystackBanks(country: 'ghana' | 'nigeria' = 'ghana') {
    return paystackClient.listBanks(country);
  },

  async getEarningsHistory(userId: string) {
    return prisma.commission.findMany({
      where: { creatorId: userId }, orderBy: { createdAt: 'desc' }, take: 50,
      include: { order: { select: { id: true, type: true, amount: true, currency: true, status: true, completedAt: true, mongoTemplateId: true } } },
    });
  },

  async getMyChangeRequests(userId: string) {
    return prisma.payoutChangeRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
  },

  // ── Admin: reviewing payout-method change requests ──────────────────────

  async getPendingChangeRequests() {
    const requests = await prisma.payoutChangeRequest.findMany({
      where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' },
    });
    const userIds = requests.map(r => r.userId);
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    return requests.map(r => ({ ...r, creator: userMap[r.userId] ?? null }));
  },

  async approveChangeRequest(requestId: string, adminId: string, adminNote?: string) {
    const req = await prisma.payoutChangeRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new AppError('Change request not found', 404);
    if (req.status !== 'PENDING') throw new AppError('This request has already been reviewed.', 400);

    await applyPayoutMethod(req.userId, req.requestedDetails as unknown as PayoutMethodInput);

    const updated = await prisma.payoutChangeRequest.update({
      where: { id: requestId },
      data:  { status: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date(), adminNote: adminNote ?? null },
    });

    // Both channels — this redirects real money, so it must reach the
    // creator reliably. Email is fire-and-forget so it never blocks the
    // admin's response.
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true, name: true } });
    if (user) {
      emailService.payoutMethodApproved(user.email, user.name ?? 'there', methodLabel(req.requestedMethod)).catch(() => {});
    }
    await prisma.notification.create({
      data: {
        userId:  req.userId,
        type:    'PAYOUT_METHOD_APPROVED',
        title:   'Payout method updated',
        message: `Your payout method change to ${methodLabel(req.requestedMethod)} has been approved and is now active.`,
      },
    }).catch(() => {});

    return updated;
  },

  async rejectChangeRequest(requestId: string, adminId: string, adminNote: string) {
    const req = await prisma.payoutChangeRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new AppError('Change request not found', 404);
    if (req.status !== 'PENDING') throw new AppError('This request has already been reviewed.', 400);

    const updated = await prisma.payoutChangeRequest.update({
      where: { id: requestId },
      data:  { status: 'REJECTED', reviewedBy: adminId, reviewedAt: new Date(), adminNote },
    });

    // Email only — a written reason reads better in email; there's no
    // pending in-app action, so no notification badge needed.
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true, name: true } });
    if (user) {
      emailService.payoutMethodRejected(user.email, user.name ?? 'there', methodLabel(req.requestedMethod), adminNote).catch(() => {});
    }

    return updated;
  },

  // ── Admin: who's owed money, and paying them ──────────────────────────

  async getPendingPayouts() {
    const wallets = await prisma.creatorWallet.findMany({ where: { pending: { gt: 0 } }, orderBy: { pending: 'desc' } });
    const userIds = wallets.map(w => w.userId);
    const [users, settings] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, country: true } }),
      prisma.payoutSetting.findMany({ where: { userId: { in: userIds } } }),
    ]);
    const userMap    = Object.fromEntries(users.map(u => [u.id, u]));
    const settingMap = Object.fromEntries(settings.map(s => [s.userId, s]));

    return wallets.map(w => ({
      creatorId:       w.userId,
      creator:         userMap[w.userId] ?? null,
      pending:         w.pending,
      payoutMethod:    settingMap[w.userId]?.primaryMethod ?? null,
      payoutFrequency: settingMap[w.userId]?.payoutFrequency ?? 'MONTHLY',
      canAutoPay:      settingMap[w.userId]?.primaryMethod === 'PAYSTACK_SUBACCOUNT' && !!settingMap[w.userId]?.paystackSubaccountCode,
    }));
  },

  // One-click payout via Paystack Transfers API.
  async payViaPaystack(creatorId: string) {
    const [wallet, settings] = await Promise.all([
      prisma.creatorWallet.findUnique({ where: { userId: creatorId } }),
      prisma.payoutSetting.findUnique({ where: { userId: creatorId } }),
    ]);
    if (!wallet || wallet.pending <= 0) throw new AppError('Nothing pending for this creator.', 400);
    if (!settings?.paystackSubaccountCode) throw new AppError('Creator has not set up Paystack payouts.', 400);

    const amount    = wallet.pending;
    const reference = `payout_${creatorId}_${Date.now()}`;

    let transfer;
    try {
      transfer = await paystackClient.initiateTransfer({
        amount: Math.round(amount * 100), recipient: settings.paystackSubaccountCode,
        reason: 'FLOWVA creator payout', reference,
      });
    } catch (err: any) {
      throw new AppError(err.response?.data?.message || 'Transfer failed.', 502);
    }

    await prisma.$transaction([
      prisma.payout.create({
        data: {
          creatorId, amount, currency: 'USD', method: 'PAYSTACK_SUBACCOUNT',
          status: transfer.status === 'success' ? 'COMPLETED' : 'PROCESSING',
          reference: transfer.transfer_code, paidAt: transfer.status === 'success' ? new Date() : null,
        },
      }),
      prisma.creatorWallet.update({ where: { userId: creatorId }, data: { pending: { decrement: amount } } }),
    ]);

    return transfer;
  },

  // Skrill/Grey: admin already sent the money by hand outside Paystack —
  // this just records it and clears the pending balance.
  async markManualPayoutPaid(creatorId: string, method: 'SKRILL' | 'GREY', reference?: string) {
    const wallet = await prisma.creatorWallet.findUnique({ where: { userId: creatorId } });
    if (!wallet || wallet.pending <= 0) throw new AppError('Nothing pending for this creator.', 400);

    const amount = wallet.pending;
    await prisma.$transaction([
      prisma.payout.create({
        data: { creatorId, amount, currency: 'USD', method, status: 'COMPLETED', reference: reference ?? null, paidAt: new Date() },
      }),
      prisma.creatorWallet.update({ where: { userId: creatorId }, data: { pending: { decrement: amount } } }),
    ]);
  },

  async getPayoutHistory(creatorId: string) {
    return prisma.payout.findMany({ where: { creatorId }, orderBy: { createdAt: 'desc' }, take: 50 });
  },
};

function methodLabel(method: string) {
  return method === 'PAYSTACK_SUBACCOUNT' ? 'Paystack' : method === 'SKRILL' ? 'Skrill' : method === 'GREY' ? 'Grey' : method;
}

// ── Internal: applies a verified method to PayoutSetting, clearing any ────
// other method's stored details so only one wallet is ever active at once.
async function applyPayoutMethod(userId: string, input: PayoutMethodInput) {
  const cleared = {
    paystackBankCode: null as string | null, paystackAccountNumber: null as string | null,
    paystackAccountName: null as string | null, paystackSubaccountCode: null as string | null,
    skrillEmail: null as string | null,
    greyAccountNumber: null as string | null, greyAccountName: null as string | null,
    isVerified: false,
  };

  if (input.method === 'PAYSTACK_SUBACCOUNT') {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { country: true } });
    if (!user || !PAYSTACK_PAYOUT_COUNTRIES.includes((user.country ?? '').toUpperCase())) {
      throw new AppError('Paystack payouts are not available for your country yet.', 400);
    }

    let resolved;
    try {
      resolved = await paystackClient.resolveAccountNumber(input.accountNumber, input.bankCode);
    } catch (err: any) {
      throw new AppError(err.response?.data?.message || 'Could not verify that account number.', 400);
    }

    let recipient;
    try {
      recipient = await paystackClient.createTransferRecipient({
        name: resolved.account_name, account_number: input.accountNumber,
        bank_code: input.bankCode, currency: input.currency,
      });
    } catch (err: any) {
      throw new AppError(err.response?.data?.message || 'Could not set up payout account.', 400);
    }

    cleared.paystackBankCode       = input.bankCode;
    cleared.paystackAccountNumber  = input.accountNumber;
    cleared.paystackAccountName    = resolved.account_name;
    cleared.paystackSubaccountCode = recipient.recipient_code;
    cleared.isVerified             = true;

  } else if (input.method === 'SKRILL') {
    if (!input.email) throw new AppError('A Skrill email is required.', 400);
    cleared.skrillEmail = input.email;
    cleared.isVerified  = true; // no verification API available for a Skrill email — consider a confirmation-link step later

  } else if (input.method === 'GREY') {
    if (!input.accountNumber || !input.accountName) throw new AppError('Grey account number and name are required.', 400);
    cleared.greyAccountNumber = input.accountNumber;
    cleared.greyAccountName   = input.accountName;
    cleared.isVerified        = true;

  } else {
    throw new AppError('Unsupported payout method.', 400);
  }

  return prisma.payoutSetting.upsert({
    where:  { userId },
    create: { userId, primaryMethod: input.method, ...cleared },
    update: { primaryMethod: input.method, ...cleared },
  });
}