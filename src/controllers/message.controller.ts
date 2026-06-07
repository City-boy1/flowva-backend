import type { Request, Response } from 'express';
import { z } from 'zod';
import { messageService } from '../services/message.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const messageController = {
  getConversations: asyncHandler(async (req: Request, res: Response) => {
    const convos = await messageService.getConversations(req.user!.id);
    res.json({ success: true, conversations: convos });
  }),

  getMessages: asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string || '1');
    const messages = await messageService.getMessages(req.params.conversationId, req.user!.id, page);
    res.json({ success: true, messages });
  }),

  send: asyncHandler(async (req: Request, res: Response) => {
    const { content, recipientId } = z.object({
      content: z.string().min(1).max(5000),
      recipientId: z.string(),
    }).parse(req.body);
    const msg = await messageService.send(req.params.conversationId, req.user!.id, recipientId, content);
    res.status(201).json({ success: true, message: msg });
  }),

  start: asyncHandler(async (req: Request, res: Response) => {
    const { recipientId, content } = z.object({
      recipientId: z.string(),
      content: z.string().min(1).max(5000),
    }).parse(req.body);
    const msg = await messageService.startConversation(req.user!.id, recipientId, content);
    res.status(201).json({ success: true, message: msg });
  }),
deleteMessage: asyncHandler(async (req: Request, res: Response) => {
    await messageService.deleteMessage(req.params.messageId, req.user!.id);
    res.json({ success: true });
  }),
  editMessage: asyncHandler(async (req: Request, res: Response) => {
  const { content } = z.object({ content: z.string().min(1).max(5000) }).parse(req.body);
  const msg = await messageService.editMessage(req.params.messageId, req.user!.id, content);
  res.json({ success: true, message: msg });
}),

typing: asyncHandler(async (req: Request, res: Response) => {
  await messageService.setTyping(req.params.conversationId, req.user!.id);
  res.json({ success: true });
}),

getTyping: asyncHandler(async (req: Request, res: Response) => {
  const typing = await messageService.getTyping(req.params.conversationId, req.user!.id);
  res.json({ success: true, typing });
}),
};