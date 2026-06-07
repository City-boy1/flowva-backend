import { Router } from 'express';
import { messageController } from '../controllers/message.controller.js';
import { authenticate } from '../middleware/auth.js';
import { msgRateLimit } from '../middleware/rateLimiter.js';

const router = Router();
router.use(authenticate);

router.get('/conversations', msgRateLimit, messageController.getConversations);
router.post('/start', messageController.start);           
router.get('/:conversationId', msgRateLimit, messageController.getMessages);
router.post('/:conversationId/typing', msgRateLimit, messageController.typing);
router.get('/:conversationId/typing', msgRateLimit, messageController.getTyping);
router.post('/:conversationId', messageController.send);
router.delete('/:messageId', messageController.deleteMessage);
router.patch('/:messageId', messageController.editMessage);

export default router;