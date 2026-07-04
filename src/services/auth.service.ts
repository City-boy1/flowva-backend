import argon2 from 'argon2';
import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  generateToken,
} from '../utils/jwt.js';
import { emailService } from './email.service.js';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

const REFRESH_DAYS = 7;

export const authService = {

  async signup(data: {
    name:           string;
    email:          string;
    password:       string;
    role:           'BUYER' | 'CREATOR';
    country:        string;
    solanaAddress?: string; // required for CREATOR, enforced at controller layer
  }) {
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new AppError('Email already registered', 409);

    // Extra service-layer guard — should never reach here for creators without
    // a wallet address since the controller validates first, but belt-and-braces
    if (data.role === 'CREATOR' && !data.solanaAddress) {
      throw new AppError(
        'A Solana USDC wallet address is required to create a creator account.',
        400,
      );
    }

    const passwordHash = await argon2.hash(data.password, {
      type:        argon2.argon2id,
      memoryCost:  65536,
      timeCost:    3,
      parallelism: 1,
    });

    const verifyToken = generateToken();

    const creatorCount = data.role === 'CREATOR'
      ? await prisma.user.count({ where: { role: 'CREATOR' } })
      : 0;
    const isEarlyAdopter = data.role === 'CREATOR' &&
      creatorCount < parseInt(process.env.EARLY_ADOPTER_LIMIT || '50', 10);

    const user = await prisma.$transaction(async (
      tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    ) => {
      const u = await tx.user.create({
        data: {
          name:             data.name,
          email:            data.email,
          passwordHash,
          role:             data.role,
          country:          data.country,
          isEarlyAdopter,
          emailVerifyToken: hashToken(verifyToken),
        },
      });

      await tx.groupMembership.create({
      data: { userId: u.id, group: 'announcements' },
    });

      if (data.role === 'CREATOR') {
        // Initialise display-only earnings tracker
        await tx.creatorWallet.create({
          data: { userId: u.id },
        });

        // Save creator's Solana USDC deposit address.
        // Helio reads this and splits 70% directly to it on every sale — on-chain,
        // no middleman. Creator withdraws to local currency (MoMo / bank) themselves
        // via their exchange app (Binance GH/KE/UG, Monica NG, Coinbase/Kraken US/UK/EU).
        await tx.payoutSetting.create({
          data: {
            userId:        u.id,
            primaryMethod: 'USDC_WALLET',
            solanaAddress: data.solanaAddress!, // validated at controller
            isVerified:    true,
          },
        });
      }

      return u;
    });

    try {
      await emailService.verifyEmail(user.email, verifyToken);
      await new Promise((r) => setTimeout(r, 800));
      await emailService.welcome(user.email, user.name);
    } catch (err) {
      logger.error('Signup email failed', {
        userId: user.id,
        error:  (err as Error).message,
      });
    }

    return { user: safeUser(user) };
  },

  async login(
    email:    string,
    password: string,
    meta:     { ua?: string; ip?: string },
  ) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      await argon2.hash('dummy_constant_time_check', { type: argon2.argon2id });
      throw new AppError('Invalid email or password', 401);
    }

    if (user.status === 'BANNED')    throw new AppError('Your account has been banned', 403);
    if (user.status === 'SUSPENDED') throw new AppError('Your account has been suspended', 403);
    if (!user.emailVerified)         throw new AppError('Please verify your email before logging in. Check your inbox.', 401);

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) throw new AppError('Invalid email or password', 401);

    const tokens = await issueTokens(user, meta);
    return { ...tokens, user: safeUser(user) };
  },

  async refresh(rawToken: string, meta: { ua?: string; ip?: string }) {
    let payload: ReturnType<typeof verifyRefreshToken>;
    try {
      payload = verifyRefreshToken(rawToken);
    } catch {
      throw new AppError('Invalid refresh token', 401);
    }

    const tokenHash = hashToken(rawToken);
    const stored    = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError('Refresh token expired', 401);
    }

    if (stored.revoked) {
      if (stored.revokedAt && (Date.now() - stored.revokedAt.getTime()) < 10_000) {
        const replacement = await prisma.refreshToken.findFirst({
          where:   { userId: stored.userId, revoked: false },
          orderBy: { createdAt: 'desc' },
        });
        if (replacement) {
          const user = await prisma.user.findUnique({ where: { id: payload.sub } });
          if (!user) throw new AppError('User not found', 404);
          const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
          return { accessToken, refreshToken: rawToken, user: safeUser(user) };
        }
      }
      throw new AppError('Refresh token revoked', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status === 'BANNED' || user.status === 'SUSPENDED') {
      throw new AppError('Account unavailable', 403);
    }

    const expiry          = new Date(Date.now() + REFRESH_DAYS * 86_400_000);
    const newRefreshToken = signRefreshToken({ sub: user.id, email: user.email, role: user.role });
    const accessToken     = signAccessToken({ sub: user.id, email: user.email, role: user.role });

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: stored.id },
        data:  { revoked: true, revokedAt: new Date() },
      }),
      prisma.refreshToken.create({
        data: {
          userId:    user.id,
          tokenHash: hashToken(newRefreshToken),
          expiresAt: expiry,
          userAgent: meta.ua,
          ipAddress: meta.ip,
        },
      }),
    ]);

    return { accessToken, refreshToken: newRefreshToken, user: safeUser(user) };
  },

  async logout(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash },
      data:  { revoked: true, revokedAt: new Date() },
    });
  },

  async verifyEmail(token: string) {
    const hashed = hashToken(token);
    const user   = await prisma.user.findFirst({ where: { emailVerifyToken: hashed } });
    if (!user) throw new AppError('Invalid or expired verification link', 400);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified:    true,
        emailVerifyToken: null,
        status:           'ACTIVE',
      },
    });
  },

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError('No account found with that email address', 404);

    const token  = generateToken();
    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data:  { passwordResetToken: hashToken(token), passwordResetExpiry: expiry },
    });

    try {
      await emailService.passwordReset(email, token);
    } catch (err) {
      logger.error('Password reset email failed', {
        userId: user.id,
        error:  (err as Error).message,
      });
      // Roll back the token so user can try again
      await prisma.user.update({
        where: { id: user.id },
        data:  { passwordResetToken: null, passwordResetExpiry: null },
      });
      throw new AppError('Failed to send reset email. Please try again later.', 500);
    }
  },
  async resetPassword(token: string, newPassword: string) {
    const hashed = hashToken(token);
    const user   = await prisma.user.findFirst({
      where: {
        passwordResetToken:  hashed,
        passwordResetExpiry: { gt: new Date() },
      },
    });
    if (!user) throw new AppError('Invalid or expired reset link', 400);

    const passwordHash = await argon2.hash(newPassword, {
      type:        argon2.argon2id,
      memoryCost:  65536,
      timeCost:    3,
      parallelism: 1,
    });

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordResetToken:  null,
          passwordResetExpiry: null,
          emailVerified:       true,
          status:              'ACTIVE',
        },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data:  { revoked: true, revokedAt: new Date() },
      }),
    ]);
  },

  async resendVerification(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError('No account found with that email address', 404);
    if (user.emailVerified) throw new AppError('This account is already verified', 400);

    const verifyToken = generateToken();
    await prisma.user.update({
      where: { id: user.id },
      data:  { emailVerifyToken: hashToken(verifyToken) },
    });

    try {
      await emailService.verifyEmail(user.email, verifyToken);
    } catch (err) {
      logger.error('Resend verification email failed', {
        userId: user.id,
        error:  (err as Error).message,
      });
      throw new AppError('Failed to send verification email. Please try again later.', 500);
    }
  },
};

async function issueTokens(
  user: { id: string; email: string; role: string },
  meta: { ua?: string; ip?: string },
) {
  const payload      = { sub: user.id, email: user.email, role: user.role };
  const accessToken  = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const expiry       = new Date(Date.now() + REFRESH_DAYS * 86_400_000);

  await prisma.$transaction([
    prisma.refreshToken.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    }),
    prisma.refreshToken.create({
      data: {
        userId:    user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: expiry,
        userAgent: meta.ua,
        ipAddress: meta.ip,
      },
    }),
  ]);

  return { accessToken, refreshToken };
}

function safeUser(u: any) {
  const {
    passwordHash,
    emailVerifyToken,
    passwordResetToken,
    passwordResetExpiry,
    ...safe
  } = u;
  return safe;
}