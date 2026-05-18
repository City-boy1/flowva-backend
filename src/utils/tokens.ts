import jwt from 'jsonwebtoken';
import type { JWTPayload } from '../types/index.js';

const ACCESS_SECRET  = process.env.JWT_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const ACCESS_EXP     = process.env.JWT_ACCESS_EXPIRES  || '15m';
const REFRESH_EXP    = process.env.JWT_REFRESH_EXPIRES || '7d';

export function generateAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXP } as jwt.SignOptions);
}

export function generateRefreshToken(payload: Pick<JWTPayload, 'id'>): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXP } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, ACCESS_SECRET) as JWTPayload;
}

export function verifyRefreshToken(token: string): Pick<JWTPayload, 'id'> {
  return jwt.verify(token, REFRESH_SECRET) as Pick<JWTPayload, 'id'>;
}