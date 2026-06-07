import { Message } from '../db/models.js';
import { AppError } from '../middleware/errorHandler.js';
import { nanoid } from 'nanoid';
import prisma from '../db/prisma.js';
import getRedis from '../db/redis.js';

export const messageService = {
  async getConversations(userId: string) {
    // Get last message per conversation the user is part of
    const convos = await Message.aggregate([
      { $match: { $or: [{ senderId: userId }, { recipientId: userId }] } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$conversationId',
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$recipientId', userId] }, { $eq: ['$read', false] }] },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { 'lastMessage.createdAt': -1 } },
    ]);

    if (!convos.length) return [];

    // Collect all partner user IDs
    const partnerIds = convos.map((c) => {
      const msg = c.lastMessage;
      return msg.senderId === userId ? msg.recipientId : msg.senderId;
    });

    // Fetch partner profiles from Postgres in one query
    const partners = await prisma.user.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, name: true, avatarUrl: true, role: true },
    });

    const partnerMap = new Map(partners.map((p) => [p.id, p]));

    return convos.map((c) => {
      const msg = c.lastMessage;
      const partnerId = msg.senderId === userId ? msg.recipientId : msg.senderId;
      const partner = partnerMap.get(partnerId);
      return {
        conversationId: c._id,
        partner: partner ?? { id: partnerId, name: 'Unknown User', avatarUrl: null, role: 'BUYER' },
        lastMessage: {
          content: msg.content,
          senderId: msg.senderId,
          createdAt: msg.createdAt,
          read: msg.read,
        },
        unreadCount: c.unreadCount,
      };
    });
  },

  async getMessages(conversationId: string, userId: string, page = 1, limit = 50) {
    const messages = await Message.find({
      conversationId,
      $or: [{ senderId: userId }, { recipientId: userId }],
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Mark as read
    await Message.updateMany(
      { conversationId, recipientId: userId, read: false },
      { read: true }
    );

    return messages.reverse();
  },

  async send(conversationId: string, senderId: string, recipientId: string, content: string) {
    if (!content.trim()) throw new AppError('Message cannot be empty', 400);

    // Verify recipient exists
    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true },
    });
    if (!recipient) throw new AppError('Recipient not found', 404);

    const msg = await Message.create({ conversationId, senderId, recipientId, content });
    return msg;
  },

  async startConversation(senderId: string, recipientId: string, content: string) {
    if (!content.trim()) throw new AppError('Message cannot be empty', 400);

    // Verify recipient exists
    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true },
    });
    if (!recipient) throw new AppError('Recipient not found', 404);

    // Check if conversation already exists between these two users
    const existing = await Message.findOne({
      $or: [
        { senderId, recipientId },
        { senderId: recipientId, recipientId: senderId },
      ],
    }).lean();

    const conversationId = existing?.conversationId ?? nanoid();
    const msg = await Message.create({ conversationId, senderId, recipientId, content });
    return msg;
  },
async deleteMessage(messageId: string, userId: string) {
    const msg = await Message.findById(messageId).lean();
    if (!msg) throw new AppError('Message not found', 404);
    if (msg.senderId !== userId) throw new AppError('Not authorised', 403);
    await Message.deleteOne({ _id: messageId });
  },
  async editMessage(messageId: string, userId: string, content: string) {
  if (!content.trim()) throw new AppError('Message cannot be empty', 400);
  const msg = await Message.findById(messageId);
  if (!msg) throw new AppError('Message not found', 404);
  if (msg.senderId !== userId) throw new AppError('Not authorised', 403);
  msg.content = content.trim();
  msg.edited = true;
  await msg.save();
  return msg;
},

async setTyping(conversationId: string, userId: string) {
  const redis = getRedis();
  await redis.set(`typing:${conversationId}`, userId, { ex: 4 });
},

async getTyping(conversationId: string, currentUserId: string) {
  const redis = getRedis();
  const userId = await redis.get(`typing:${conversationId}`);
  if (!userId || userId === currentUserId) return false;
  return true;
},
};