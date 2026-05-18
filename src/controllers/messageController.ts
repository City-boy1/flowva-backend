import type { Response } from 'express';
import type { AuthRequest } from '../types/index.js';
import { Message, User } from '../db/mongoose.js';
import mongoose from 'mongoose';

// Deterministic conversation ID from two user IDs
function conversationId(a: string, b: string): string {
  return [a, b].sort().join('_');
}

// ── GET MY CONVERSATIONS ──────────────────────────────
export async function getConversations(req: AuthRequest, res: Response): Promise<void> {
  const myId = req.user!.id;

  // Find all unique conversations involving this user
  const convs = await Message.aggregate([
    {
      $match: {
        $or: [
          { senderId:   new mongoose.Types.ObjectId(myId) },
          { receiverId: new mongoose.Types.ObjectId(myId) },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id:         '$conversationId',
        lastMessage: { $first: '$text' },
        lastTime:    { $first: '$createdAt' },
        unread: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: ['$receiverId', new mongoose.Types.ObjectId(myId)] },
                { $eq: ['$read', false] },
              ]},
              1, 0,
            ],
          },
        },
        otherId: {
          $first: {
            $cond: [
              { $eq: ['$senderId', new mongoose.Types.ObjectId(myId)] },
              '$receiverId',
              '$senderId',
            ],
          },
        },
      },
    },
    { $sort: { lastTime: -1 } },
    { $limit: 50 },
  ]);

  // Hydrate other user info
  const otherIds = convs.map(c => c.otherId);
  const users    = await User.find({ _id: { $in: otherIds } }).select('name avatar role');
  const userMap  = Object.fromEntries(users.map(u => [u._id.toString(), u]));

  const result = convs.map(c => ({
    conversationId: c._id,
    lastMessage:    c.lastMessage,
    lastTime:       c.lastTime,
    unread:         c.unread,
    other:          userMap[c.otherId.toString()] ?? null,
  }));

  res.json({ success: true, data: result });
}

// ── GET MESSAGES IN A CONVERSATION ───────────────────
export async function getMessages(req: AuthRequest, res: Response): Promise<void> {
  const { conversationId: convId } = req.params;
  const myId = req.user!.id;

  // Security: user must be part of this conversation
  const [idA, idB] = convId.split('_');
  if (idA !== myId && idB !== myId) {
    res.status(403).json({ success: false, message: 'Access denied' });
    return;
  }

  const messages = await Message.find({ conversationId: convId })
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  // Mark messages sent to me as read
  await Message.updateMany(
    { conversationId: convId, receiverId: myId, read: false },
    { $set: { read: true } }
  );

  res.json({ success: true, data: messages });
}

// ── SEND A MESSAGE ────────────────────────────────────
export async function sendMessage(req: AuthRequest, res: Response): Promise<void> {
  const { receiverId, text } = req.body as { receiverId: string; text: string };
  const senderId = req.user!.id;

  if (senderId === receiverId) {
    res.status(400).json({ success: false, message: 'Cannot message yourself' });
    return;
  }

  const receiver = await User.findById(receiverId);
  if (!receiver) {
    res.status(404).json({ success: false, message: 'Recipient not found' });
    return;
  }

  const convId = conversationId(senderId, receiverId);

  const message = await Message.create({
    conversationId: convId,
    senderId,
    receiverId,
    text,
    read: false,
  });

  res.status(201).json({ success: true, data: message });
}