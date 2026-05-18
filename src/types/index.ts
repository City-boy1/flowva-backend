import type { Request } from 'express';

// ── Authenticated request ──────────────────────
export interface AuthRequest extends Request {
  user?: {
    id:    string;
    email: string;
    role:  'BUYER' | 'CREATOR' | 'ADMIN';
    name:  string;
    stripeAccountId?: string;
  };
}

// ── JWT payload ───────────────────────────────
export interface JWTPayload {
  id:    string;
  email: string;
  role:  string;
}

// ── API response wrapper ──────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?:   T;
  message?: string;
  error?:  string;
}

// ── Pagination ────────────────────────────────
export interface PaginationQuery {
  page?:  string;
  limit?: string;
  sort?:  string;
  order?: 'asc' | 'desc';
}