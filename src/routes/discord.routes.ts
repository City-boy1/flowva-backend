import express, { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import prisma from '../db/prisma.js';

const router = express.Router();

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;
const WEBHOOK_MAP: Record<string, string> = {
  general: process.env.DISCORD_WEBHOOK_GENERAL!,
  creators: process.env.DISCORD_WEBHOOK_CREATORS!,
  clients: process.env.DISCORD_WEBHOOK_CLIENTS!,
  announcements: process.env.DISCORD_WEBHOOK_ANNOUNCE!,
};

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

const AVATAR_COLORS = ['F87171','FB923C','FBBF24','4ADE80','2DD4BF','60A5FA','818CF8','C084FC','F472B6','FF2E93'];
function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

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
  if (tab === 'announcements' && msgUser.role !== 'ADMIN') {
    throw new AppError('Only admins can post in #announcements', 403);
  }

  const membership = await prisma.groupMembership.findUnique({
    where: { userId_group: { userId: msgUser.id, group: tab } },
  });
  if (!membership) throw new AppError('Join this group before sending messages', 403);
  if (!message?.trim()) throw new AppError('Message is required', 400);

  const discordRes = await fetch(`${WEBHOOK_MAP[tab]}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: message,
      username: dbUser.name,
      avatar_url: dbUser.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(dbUser.name)}&background=${colorForName(dbUser.name)}&color=fff`,
    }),
  });
  const discordMsg = await discordRes.json() as { id: string };

  await prisma.chatMessage.create({
    data: { discordMessageId: discordMsg.id, group: tab, authorId: msgUser.id },
  });

  res.json({ success: true });
}));

router.post('/message/:tab/reply', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { tab } = req.params;
  const { message, replyToContent } = req.body;
  const msgUser = (req as any).user;
  const dbUser = await prisma.user.findUnique({ where: { id: msgUser.id }, select: { name: true, avatarUrl: true } });
  if (!dbUser) throw new AppError('User not found', 404);
  if (!message?.trim()) throw new AppError('Message is required', 400);

  const membership = await prisma.groupMembership.findUnique({
    where: { userId_group: { userId: msgUser.id, group: tab } },
  });
  if (!membership) throw new AppError('Join this group before sending messages', 403);

  const quoted = replyToContent ? `> ${String(replyToContent).slice(0, 100)}\n` : '';
  const discordRes = await fetch(`${WEBHOOK_MAP[tab]}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: `${quoted}${message}`,
      username: dbUser.name,
      avatar_url: dbUser.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(dbUser.name)}&background=${colorForName(dbUser.name)}&color=fff`,
    }),
  });
  const discordMsg = await discordRes.json() as { id: string };

  await prisma.chatMessage.create({
    data: { discordMessageId: discordMsg.id, group: tab, authorId: msgUser.id },
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

  const formatted = (messages as any[]).reverse().map((m: any) => ({
  id: m.id,
  content: m.content,
  timestamp: m.timestamp,
  authorId: m.author?.id,
  authorName: m.author?.username || 'Unknown',
  authorAvatar: m.author?.avatar
    ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png`
    : `https://ui-avatars.com/api/?name=${encodeURIComponent(m.author?.username || 'U')}&background=${colorForName(m.author?.username || 'U')}&color=fff`,
  reactions: m.reactions || [],
  referencedMessage: m.referenced_message ? { content: m.referenced_message.content } : null,
}));

  res.json({ messages: formatted });
}));

router.patch('/message/:tab/:messageId', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { tab, messageId } = req.params;
  const { content } = req.body;
  const msgUser = (req as any).user;

  const record = await prisma.chatMessage.findUnique({ where: { discordMessageId: messageId } });
  if (!record || record.authorId !== msgUser.id) throw new AppError('You can only edit your own messages', 403);
  if (!content?.trim()) throw new AppError('Message content is required', 400);

  await fetch(`${WEBHOOK_MAP[tab]}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  res.json({ success: true });
}));

router.delete('/message/:tab/:messageId', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { tab, messageId } = req.params;
  const msgUser = (req as any).user;

  const record = await prisma.chatMessage.findUnique({ where: { discordMessageId: messageId } });
  if (!record || record.authorId !== msgUser.id) throw new AppError('You can only delete your own messages', 403);

  await fetch(`${WEBHOOK_MAP[tab]}/messages/${messageId}`, { method: 'DELETE' });
  await prisma.chatMessage.delete({ where: { discordMessageId: messageId } });
  res.json({ success: true });
}));

router.post('/message/:tab/:messageId/react', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { tab, messageId } = req.params;
  const { emoji } = req.body;
  if (!emoji) throw new AppError('Emoji is required', 400);
  const channelId = CHANNEL_MAP[tab] || CHANNEL_MAP.general;

  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, {
    method: 'PUT',
    headers: botHeaders,
  });
  res.json({ success: true });
}));

router.put('/message/:tab/:messageId/pin', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { tab, messageId } = req.params;
  const channelId = CHANNEL_MAP[tab] || CHANNEL_MAP.general;

  await fetch(`https://discord.com/api/v10/channels/${channelId}/pins/${messageId}`, {
    method: 'PUT',
    headers: botHeaders,
  });
  res.json({ success: true });
}));

router.get('/message/:tab/pins', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { tab } = req.params;
  const channelId = CHANNEL_MAP[tab] || CHANNEL_MAP.general;
  const discordRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/pins`, { headers: botHeaders });
  const pins = await discordRes.json();
  const formatted = (pins as any[]).map((m: any) => ({ id: m.id, content: m.content, authorName: m.author?.username || 'Unknown' }));
  res.json({ pins: formatted });
}));

router.get('/profile/message/:messageId', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const record = await prisma.chatMessage.findUnique({
    where: { discordMessageId: req.params.messageId },
    include: { author: { select: { name: true, avatarUrl: true, createdAt: true } } },
  });
  if (!record) throw new AppError('Not found', 404);
  res.json(record.author);
}));

router.get('/memberships', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const memberships = await prisma.groupMembership.findMany({
    where: { userId: (req as any).user.id },
    select: { group: true },
  });
  res.json({ groups: memberships.map(m => m.group) });
}));

router.post('/join/:group', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { group } = req.params;
  const msgUser = (req as any).user;
  if (group === 'creators' && msgUser.role !== 'CREATOR') throw new AppError('Only Creators can join #creators', 403);
  if (group === 'clients' && msgUser.role !== 'BUYER') throw new AppError('Only Clients can join #clients', 403);

  await prisma.groupMembership.upsert({
    where: { userId_group: { userId: msgUser.id, group } },
    update: {},
    create: { userId: msgUser.id, group },
  });
  res.json({ success: true });
}));

export default router;