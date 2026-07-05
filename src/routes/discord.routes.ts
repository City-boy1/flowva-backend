import express, { Request, Response as ExpressResponse, NextFunction } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import prisma from '../db/prisma.js';
import { Redis } from '@upstash/redis';

const router = express.Router();
const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
const PRESENCE_TTL_MS = 45_000; // a user "drops off" if no heartbeat in 45s

// ── Rate limiting ──
// Discord webhooks allow ~5 requests/2s per webhook; this keeps any single
// user from being able to burn through that budget (or spam the room).
const sendLimiter = rateLimit({
  windowMs: 10_000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).user?.id || req.ip,
  message: { error: 'You are sending messages too fast — slow down a little.' },
});

// ── Webhook post with automatic 429 backoff ──
// Discord returns 429 with a `retry_after` (seconds) when a webhook is
// rate-limited. One retry covers real-world bursts without hanging the
// request indefinitely.
async function postToWebhook(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 429) {
    const body: any = await res.json().catch(() => ({}));
    const waitMs = Math.min(Math.ceil(((body?.retry_after ?? 1) as number) * 1000), 5000);
    await new Promise(r => setTimeout(r, waitMs));
    return fetch(url, init);
  }
  return res;
}

// ── Media upload config ──
// Discord's non-boosted bot upload cap is 25MB; we mirror that here so
// oversized files are rejected before we ever try to hit the webhook.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIME.has(file.mimetype)) {
      cb(new AppError('That file type is not allowed', 400) as any);
      return;
    }
    cb(null, true);
  },
});

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
router.post('/message', authenticate, sendLimiter, asyncHandler(async (req: Request, res: ExpressResponse) => {
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

  const discordRes = await postToWebhook(`${WEBHOOK_MAP[tab]}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: message,
      username: dbUser.name,
      avatar_url: dbUser.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(dbUser.name)}&background=${colorForName(dbUser.name)}&color=fff`,
    }),
  });
  if (!discordRes.ok) throw new AppError('Failed to deliver message to Discord', 502);
  const discordMsg = await discordRes.json() as { id: string };

  await prisma.chatMessage.create({
    data: { discordMessageId: discordMsg.id, group: tab, authorId: msgUser.id },
  });

  res.json({ success: true });
}));

router.post('/message/:tab/reply', authenticate, sendLimiter, asyncHandler(async (req: Request, res: ExpressResponse) => {
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
  const discordRes = await postToWebhook(`${WEBHOOK_MAP[tab]}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: `${quoted}${message}`,
      username: dbUser.name,
      avatar_url: dbUser.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(dbUser.name)}&background=${colorForName(dbUser.name)}&color=fff`,
    }),
  });
  if (!discordRes.ok) throw new AppError('Failed to deliver message to Discord', 502);
  const discordMsg = await discordRes.json() as { id: string };

  await prisma.chatMessage.create({
    data: { discordMessageId: discordMsg.id, group: tab, authorId: msgUser.id },
  });

  res.json({ success: true });
}));

// ── Send a media attachment — called from the paperclip/file-picker in chat input ──
router.post('/message/:tab/upload', authenticate, sendLimiter, upload.single('file'), asyncHandler(async (req: Request, res: ExpressResponse) => {
  const { tab } = req.params;
  const caption = (req.body?.message || '').toString();
  const msgUser = (req as any).user;
  const file = (req as any).file as Express.Multer.File | undefined;

  if (!file) throw new AppError('A file is required', 400);
  if (!WEBHOOK_MAP[tab]) throw new AppError('Unknown channel', 400);

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

  const dbUser = await prisma.user.findUnique({
    where: { id: msgUser.id },
    select: { name: true, avatarUrl: true },
  });
  if (!dbUser) throw new AppError('User not found', 404);

  // Discord webhook multipart contract: JSON payload goes in a "payload_json"
  // field, the binary goes in a "files[0]" field with the original filename.
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content: caption.slice(0, 2000),
    username: dbUser.name,
    avatar_url: dbUser.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(dbUser.name)}&background=${colorForName(dbUser.name)}&color=fff`,
  }));
  form.append('files[0]', new Blob([file.buffer], { type: file.mimetype }), file.originalname);

  const discordRes = await postToWebhook(`${WEBHOOK_MAP[tab]}?wait=true`, {
    method: 'POST',
    body: form,
  });
  if (!discordRes.ok) throw new AppError('Failed to deliver attachment to Discord', 502);
  const discordMsg = await discordRes.json() as { id: string; attachments?: any[] };

  await prisma.chatMessage.create({
    data: { discordMessageId: discordMsg.id, group: tab, authorId: msgUser.id },
  });

  res.json({ success: true, attachments: discordMsg.attachments || [] });
}));

// Multer throws before asyncHandler ever runs (bad file type, over the size
// cap), so it needs its own handler here instead of relying on the global
// error middleware to guess the shape of the error.
router.use('/message/:tab/upload', (err: any, _req: Request, res: ExpressResponse, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File is over the 25MB limit' });
    }
    return res.status(400).json({ error: 'Upload failed: ' + err.message });
  }
  if (err instanceof AppError) {
    return res.status((err as any).statusCode || 400).json({ error: err.message });
  }
  return next(err);
});

// ── Get messages — polled by frontend to render the chat ──
router.get('/messages/:tab', authenticate, asyncHandler(async (req: Request, res: ExpressResponse) => {
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
  const messageIds = (messages as any[]).map(m => m.id);

  // Reaction counts/ownership come from our own table, not Discord's —
  // every message is posted by the bot via webhook, so Discord only ever
  // sees "the bot reacted", never which Flowva user did.
  const reactionRows = messageIds.length
    ? await prisma.messageReaction.findMany({ where: { discordMessageId: { in: messageIds } } })
    : [];
  const reactionsByMessage = new Map<string, Map<string, { count: number; reactedByMe: boolean }>>();
  for (const r of reactionRows) {
    if (!reactionsByMessage.has(r.discordMessageId)) reactionsByMessage.set(r.discordMessageId, new Map());
    const perEmoji = reactionsByMessage.get(r.discordMessageId)!;
    const entry = perEmoji.get(r.emoji) || { count: 0, reactedByMe: false };
    entry.count += 1;
    if (r.userId === msgUser.id) entry.reactedByMe = true;
    perEmoji.set(r.emoji, entry);
  }

  const formatted = (messages as any[]).reverse().map((m: any) => ({
  id: m.id,
  content: m.content,
  timestamp: m.timestamp,
  authorId: m.author?.id,
  authorName: m.author?.username || 'Unknown',
  authorAvatar: m.author?.avatar
    ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png`
    : `https://ui-avatars.com/api/?name=${encodeURIComponent(m.author?.username || 'U')}&background=${colorForName(m.author?.username || 'U')}&color=fff`,
  reactions: Array.from((reactionsByMessage.get(m.id) || new Map()).entries())
    .map(([emoji, v]) => ({ emoji, count: v.count, reactedByMe: v.reactedByMe })),
  referencedMessage: m.referenced_message ? { content: m.referenced_message.content } : null,
  attachments: (m.attachments || []).map((a: any) => ({
    id: a.id,
    url: a.url,
    filename: a.filename,
    contentType: a.content_type || '',
    size: a.size,
  })),
}));

  res.json({ messages: formatted });
}));

router.patch('/message/:tab/:messageId', authenticate, asyncHandler(async (req: Request, res: ExpressResponse) => {
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

router.delete('/message/:tab/:messageId', authenticate, asyncHandler(async (req: Request, res: ExpressResponse) => {
  const { tab, messageId } = req.params;
  const msgUser = (req as any).user;

  const record = await prisma.chatMessage.findUnique({ where: { discordMessageId: messageId } });
  if (!record || record.authorId !== msgUser.id) throw new AppError('You can only delete your own messages', 403);

  await fetch(`${WEBHOOK_MAP[tab]}/messages/${messageId}`, { method: 'DELETE' });
  await prisma.messageReaction.deleteMany({ where: { discordMessageId: messageId } });
  await prisma.chatMessage.delete({ where: { discordMessageId: messageId } });
  res.json({ success: true });
}));

router.post('/message/:tab/:messageId/react', authenticate, asyncHandler(async (req: Request, res: ExpressResponse) => {
  const { tab, messageId } = req.params;
  const { emoji } = req.body;
  const msgUser = (req as any).user;
  if (!emoji) throw new AppError('Emoji is required', 400);
  const channelId = CHANNEL_MAP[tab] || CHANNEL_MAP.general;

  const existing = await prisma.messageReaction.findUnique({
    where: { discordMessageId_userId: { discordMessageId: messageId, userId: msgUser.id } },
  });

  let action: 'added' | 'removed' | 'changed';
  let previousEmoji: string | null = null;

  if (existing && existing.emoji === emoji) {
    // Same emoji tapped again → remove it (WhatsApp/Discord-style toggle off).
    await prisma.messageReaction.delete({ where: { id: existing.id } });
    action = 'removed';
  } else if (existing) {
    previousEmoji = existing.emoji;
    await prisma.messageReaction.update({ where: { id: existing.id }, data: { emoji } });
    action = 'changed';
  } else {
    await prisma.messageReaction.create({ data: { discordMessageId: messageId, userId: msgUser.id, emoji } });
    action = 'added';
  }

  // Best-effort sync of the bot's own reaction on the Discord side (used only
  // so the message doesn't look "unreacted" if you check the Discord server
  // directly — never blocks the response to the user).
  (async () => {
    try {
      if (action === 'removed') {
        const stillUsed = await prisma.messageReaction.findFirst({ where: { discordMessageId: messageId, emoji } });
        if (!stillUsed) {
          await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { method: 'DELETE', headers: botHeaders });
        }
      } else {
        await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { method: 'PUT', headers: botHeaders });
        if (previousEmoji) {
          const stillUsed = await prisma.messageReaction.findFirst({ where: { discordMessageId: messageId, emoji: previousEmoji } });
          if (!stillUsed) {
            await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(previousEmoji)}/@me`, { method: 'DELETE', headers: botHeaders });
          }
        }
      }
    } catch { /* non-critical — DB is the source of truth for the UI */ }
  })();

  res.json({ success: true, action });
}));

router.put('/message/:tab/:messageId/pin', authenticate, asyncHandler(async (req: Request, res: ExpressResponse) => {
  const { tab, messageId } = req.params;
  const channelId = CHANNEL_MAP[tab] || CHANNEL_MAP.general;

  const discordRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/pins/${messageId}`, {
    method: 'PUT',
    headers: botHeaders,
  });

  if (!discordRes.ok) {
    const body = await discordRes.text().catch(() => '');
    console.error('Discord pin failed:', discordRes.status, body);
    throw new AppError(
      discordRes.status === 403
        ? 'Bot is missing permission to pin messages in this channel'
        : 'Failed to pin message on Discord',
      502
    );
  }

  res.json({ success: true });
}));

router.get('/message/:tab/pins', authenticate, asyncHandler(async (req: Request, res: ExpressResponse) => {
  const { tab } = req.params;
  const channelId = CHANNEL_MAP[tab] || CHANNEL_MAP.general;
  const discordRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/pins`, { headers: botHeaders });
  if (!discordRes.ok) throw new AppError('Failed to fetch pinned messages', 502);
  const pins = await discordRes.json();
  if (!Array.isArray(pins)) throw new AppError('Unexpected response from Discord', 502);
  const formatted = pins.map((m: any) => ({ id: m.id, content: m.content, authorName: m.author?.username || 'Unknown' }));
  res.json({ pins: formatted });
}));

router.get('/profile/message/:messageId', authenticate, asyncHandler(async (req: Request, res: ExpressResponse) => {
  const record = await prisma.chatMessage.findUnique({
    where: { discordMessageId: req.params.messageId },
    include: { author: { select: { name: true, avatarUrl: true, createdAt: true } } },
  });
  if (!record) throw new AppError('Not found', 404);
  res.json(record.author);
}));

router.get('/memberships', authenticate, asyncHandler(async (req: Request, res: ExpressResponse) => {
  const memberships = await prisma.groupMembership.findMany({
    where: { userId: (req as any).user.id },
    select: { group: true },
  });
  res.json({ groups: memberships.map(m => m.group) });
}));

router.post('/join/:group', authenticate, asyncHandler(async (req: Request, res: ExpressResponse) => {
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

// ── Presence: called every ~20s by the frontend while the chat page is open ──
router.post('/presence/ping', authenticate, asyncHandler(async (req: Request, res: ExpressResponse) => {
  const msgUser = (req as any).user;
  await redis.zadd('presence:online', { score: Date.now(), member: msgUser.id });
  res.json({ success: true });
}));

router.get('/presence/count', asyncHandler(async (_req: Request, res: ExpressResponse) => {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  await redis.zremrangebyscore('presence:online', 0, cutoff); // drop anyone who stopped pinging
  const count = await redis.zcard('presence:online');
  res.json({ count });
}));

export default router;