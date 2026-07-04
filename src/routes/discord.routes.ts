import express, { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import prisma from '../db/prisma.js';

const router = express.Router();

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

const CHANNEL_MAP: Record<string, string> = {
  general:       process.env.DISCORD_GENERAL_CHANNEL_ID    || '1520807249570959492',
  creators:      process.env.DISCORD_CREATORS_CHANNEL_ID   || '1520812581374398544',
  clients:       process.env.DISCORD_CLIENTS_CHANNEL_ID    || '1520812665767727265',
  announcements: process.env.DISCORD_ANNOUNCE_CHANNEL_ID   || '1520812797825515541',
};

const botHeaders = {
  'Authorization': `Bot ${BOT_TOKEN}`,
  'Content-Type': 'application/json',
};

// ── Send message — called when user types in the Flowva chat input ──
router.post('/message', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { message, tab } = req.body;
  const msgUser = (req as any).user;
  const dbUser = await prisma.user.findUnique({
    where: { id: msgUser.id },
    select: { name: true, avatarUrl: true },
  });
  if (!dbUser) throw new AppError('User not found', 404);

  if (tab === 'creators' && msgUser.role !== 'CREATOR') {
    throw new AppError('Only Creators can post in #creators', 403);
  }
  if (tab === 'clients' && msgUser.role !== 'BUYER') {
    throw new AppError('Only Clients can post in #clients', 403);
  }
  if (!message?.trim()) throw new AppError('Message is required', 400);

  const channelId = CHANNEL_MAP[tab] || CHANNEL_MAP.general;

  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: botHeaders,
    body: JSON.stringify({
      content: `**${dbUser.name}:** ${message}`,
    }),
  });

  res.json({ success: true });
}));

// ── Get messages — polled by frontend to render the chat ──
router.get('/messages/:tab', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { tab } = req.params;
  const msgUser = (req as any).user;

  if (tab === 'creators' && msgUser.role !== 'CREATOR') {
    throw new AppError('Only Creators can view #creators', 403);
  }
  if (tab === 'clients' && msgUser.role !== 'BUYER') {
    throw new AppError('Only Clients can view #clients', 403);
  }

  const channelId = CHANNEL_MAP[tab] || CHANNEL_MAP.general;
  const discordRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=50`, {
    headers: botHeaders,
  });
  const messages = await discordRes.json();

  const formatted = (messages as any[]).reverse().map(m => ({
    content: m.content,
    timestamp: m.timestamp,
  }));

  res.json({ messages: formatted });
}));

export default router;