import { Router, Request, Response } from 'express';
import { emailService } from '../services/email.service.js';
import { authRateLimit } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/', authRateLimit, async (req: Request, res: Response) => {
  const { firstName, lastName, email, subject, message, username } = req.body;

  if (!firstName || !lastName || !email || !subject || !message) {
    return res.status(400).json({ message: 'Please fill in all required fields.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Invalid email address.' });
  }

  try {
    await emailService.contactForm(
      `${firstName} ${lastName}`,
      email,
      subject,
      message,
      username || undefined
    );
    return res.status(200).json({ message: 'Message sent successfully.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to send message. Please try again.' });
  }
});

export default router;