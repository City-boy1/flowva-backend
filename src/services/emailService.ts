import { Resend } from 'resend';
import logger from '../utils/logger.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.FROM_EMAIL  ?? 'noreply@flowva.com';
const ADMIN  = process.env.ADMIN_EMAIL ?? '';

// ── Send purchase confirmation to buyer ──────────────
export async function sendPurchaseConfirmation(opts: {
  buyerEmail:    string;
  buyerName:     string;
  templateTitle: string;
  downloadUrl:   string;
  amount:        number;
}): Promise<void> {
  if (!ADMIN) return;

  try {
    await resend.emails.send({
      from:    FROM,
      to:      opts.buyerEmail,
      subject: `Your purchase: ${opts.templateTitle} — FLOWVA`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:auto">
          <h2 style="color:#7c3aed">Purchase Confirmed ✓</h2>
          <p>Hi ${opts.buyerName},</p>
          <p>You've successfully purchased <strong>${opts.templateTitle}</strong> for $${opts.amount.toFixed(2)}.</p>
          <p>
            <a href="${opts.downloadUrl}"
               style="display:inline-block;background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
              Download Template
            </a>
          </p>
          <p style="color:#94a3b8;font-size:0.85rem">FLOWVA — Premium Motion Graphics Marketplace</p>
        </div>
      `,
    });
  } catch (err) {
    logger.error('Failed to send purchase confirmation email', err);
  }
}

// ── Notify creator of a sale ─────────────────────────
export async function sendSaleNotification(opts: {
  creatorEmail:  string;
  creatorName:   string;
  templateTitle: string;
  creatorEarns:  number;
}): Promise<void> {
  try {
    await resend.emails.send({
      from:    FROM,
      to:      opts.creatorEmail,
      subject: `💰 New sale: ${opts.templateTitle} — FLOWVA`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:auto">
          <h2 style="color:#10b981">You Made a Sale! 🎉</h2>
          <p>Hi ${opts.creatorName},</p>
          <p><strong>${opts.templateTitle}</strong> was just purchased.</p>
          <p>You earned: <strong style="color:#10b981;font-size:1.3rem">$${opts.creatorEarns.toFixed(2)}</strong></p>
          <p>Log in to your dashboard to track your earnings and payout status.</p>
          <a href="${process.env.FRONTEND_URL}/dashboard.html#payout"
             style="display:inline-block;background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            View Dashboard
          </a>
          <p style="color:#94a3b8;font-size:0.85rem;margin-top:24px">FLOWVA — Premium Motion Graphics Marketplace</p>
        </div>
      `,
    });
  } catch (err) {
    logger.error('Failed to send sale notification email', err);
  }
}

// ── DB size alert to admin ────────────────────────────
export async function sendDbSizeAlert(opts: {
  db:       'MongoDB' | 'PostgreSQL';
  sizeMB:   number;
  limitMB:  number;
}): Promise<void> {
  if (!ADMIN) return;

  try {
    await resend.emails.send({
      from:    FROM,
      to:      ADMIN,
      subject: `⚠️ FLOWVA: ${opts.db} approaching storage limit`,
      html: `
        <p><strong>${opts.db}</strong> is at <strong>${opts.sizeMB} MB</strong>
        (limit: ${opts.limitMB} MB).</p>
        <p>Take action: upgrade plan or archive old data.</p>
      `,
    });
  } catch (err) {
    logger.error('Failed to send DB size alert', err);
  }
}