import type { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

// Validates req.body against a Zod schema.
// Returns 400 with field-level errors if validation fails.
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field:   e.path.join('.'),
        message: e.message,
      }));

      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
      return;
    }

    req.body = result.data; // use the parsed/coerced data
    next();
  };
}

// ── Zod schemas ──────────────────────────────────────

export const registerSchema = z.object({
  name:     z.string().min(2).max(100).trim(),
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(6).max(128),
  role:     z.enum(['buyer', 'creator']).default('buyer'),
});

export const loginSchema = z.object({
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

export const templateCreateSchema = z.object({
  title:       z.string().min(3).max(150).trim(),
  description: z.string().min(10).max(2000).trim(),
  category:    z.string().min(1).toLowerCase().trim(),
  price:       z.coerce.number().min(0).max(10000),
  software:    z.string().max(200).trim().optional(),
  tags:        z.array(z.string().max(50)).max(10).optional(),
});

export const payoutSchema = z.object({
  method:  z.enum(['stripe', 'momo', 'bank', 'paypal']),
  account: z.string().min(3).max(200).trim(),
  name:    z.string().min(2).max(100).trim(),
});

export const messageSchema = z.object({
  receiverId: z.string().min(1),
  text:       z.string().min(1).max(4000).trim(),
});