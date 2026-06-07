import { Resend } from 'resend';
import logger from '../utils/logger.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';
const BASE = process.env.FRONTEND_URL || 'http://127.0.0.1:5500';

// In dev, all emails go to your verified Resend address
// In production, emails go to the actual user
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || null;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEV_OVERRIDE = IS_PRODUCTION ? null : (process.env.RESEND_DEV_TO || ADMIN_EMAIL || null);

async function send(to: string, subject: string, html: string) {
  const recipient = DEV_OVERRIDE || to;
  const finalSubject = DEV_OVERRIDE ? `[TO: ${to}] ${subject}` : subject;

  try {
    console.log(`SENDING EMAIL → to: ${recipient} | subject: ${finalSubject}`);

    const ADMIN_COPY_SUBJECTS = [
  'You just made a sale',
  'Dispute opened',
];

const shouldCopyAdmin = IS_PRODUCTION &&
  ADMIN_EMAIL &&
  ADMIN_EMAIL !== recipient &&
  ADMIN_COPY_SUBJECTS.some(s => subject.includes(s));

const result = await resend.emails.send({
  from:    `FLOWVA <${FROM}>`,
  to:      shouldCopyAdmin ? [recipient, ADMIN_EMAIL!] : recipient,
  subject: finalSubject,
  html,
});

    if ((result as any).error) {
      console.error('RESEND REJECTED:', JSON.stringify((result as any).error));
      logger.error('Resend API error', {
        to: recipient,
        subject: finalSubject,
        error: (result as any).error,
      });
      return;
    }

    console.log('EMAIL SENT:', (result as any).data?.id);
    logger.info('Email sent', { to: recipient, subject: finalSubject, id: (result as any).data?.id });
  } catch (err) {
    console.error('EMAIL EXCEPTION:', err);
    logger.error('Email send exception', {
      to: recipient,
      subject: finalSubject,
      error: (err as Error).message,
    });
  }
}

export const emailService = {

  verifyEmail: (to: string, token: string) => {
    const link = `${BASE}/verify-email.html?token=${token}`;
    console.log('VERIFY LINK:', link);
    return send(
      to,
      'Activate your FLOWVA account',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2 style="color:#7c3aed">Activate your account</h2>
        <p>Click the button below to verify your email and activate your FLOWVA account.</p>
        <a href="${link}"
           style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
          Activate Account
        </a>
        <p style="color:#888;font-size:0.85rem">Link expires in 24 hours. If you didn't sign up, ignore this email.</p>
        <p style="color:#888;font-size:0.75rem">Or copy this link: ${link}</p>
      </div>`
    );
  },

  passwordReset: (to: string, token: string) => {
    const link = `${BASE}/reset-password.html?token=${token}`;
    console.log('RESET LINK:', link);
    return send(
      to,
      'Reset your FLOWVA password',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2 style="color:#7c3aed">Reset your password</h2>
        <p>Click the button below to set a new password.</p>
        <a href="${link}"
           style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
          Reset Password
        </a>
        <p style="color:#888;font-size:0.85rem">Link expires in 1 hour. If you didn't request this, ignore this email.</p>
        <p style="color:#888;font-size:0.75rem">Or copy this link: ${link}</p>
      </div>`
    );
  },

  orderConfirmation: (to: string, orderId: string, amount: number, currency: string) =>
    send(
      to,
      'Order confirmed — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2 style="color:#7c3aed">Order Confirmed ✓</h2>
        <p>Your order <strong>${orderId}</strong> of <strong>${currency} ${amount}</strong> is confirmed.</p>
        <a href="${BASE}/dashboard.html"
           style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
          View Dashboard
        </a>
      </div>`
    ),

  orderDelivered: (to: string, orderId: string) =>
    send(
      to,
      'Your order has been delivered — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2 style="color:#7c3aed">Order Delivered 📦</h2>
        <p>Order <strong>${orderId}</strong> has been delivered. Please review and approve or request a revision.</p>
        <a href="${BASE}/dashboard.html"
           style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
          Review Order
        </a>
      </div>`
    ),

  // ── Replaces withdrawalProcessed ────────────────────────────────────────────
  // Helio splits on-chain at checkout. Creators receive USDC directly to their
  // exchange deposit address (Binance/Monica/Coinbase) and withdraw to local
  // currency themselves. FLOWVA never holds or sends withdrawal payments.
  salePayoutSent: (to: string, creatorName: string, amount: number, solanaAddress: string) =>
    send(
      to,
      'Your earnings have been sent — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed;margin-bottom:4px">💸 Earnings Sent</h2>
          <p style="color:#6b7280;margin-top:0">Hi ${creatorName}, your earnings have been sent to your wallet.</p>
          <div style="background:#f5f3ff;border-radius:8px;padding:16px;margin:20px 0">
            <div style="font-size:0.75rem;color:#6b7280">Amount</div>
            <div style="font-weight:700;color:#7c3aed;font-size:1.2rem">USDC ${amount.toFixed(2)}</div>
            <div style="font-size:0.75rem;color:#6b7280;margin-top:12px">Sent to</div>
            <div style="font-weight:600;color:#111;font-size:0.8rem;word-break:break-all">${solanaAddress}</div>
          </div>
          <p style="font-size:0.85rem;color:#6b7280;line-height:1.6">
            The USDC has arrived in your exchange wallet (Binance, Monica, Coinbase, etc).
            Open your exchange app to convert to local currency and withdraw to your bank or mobile money.
          </p>
          <a href="${BASE}/dashboard.html#earnings"
             style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
            View Earnings
          </a>
        </div>
      </div>`
    ),

  bidAccepted: (to: string, projectTitle: string) =>
    send(
      to,
      'Your bid was accepted — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2 style="color:#7c3aed">Bid Accepted 🎉</h2>
        <p>Your bid on <strong>${projectTitle}</strong> was accepted. Log in to get started.</p>
        <a href="${BASE}/dashboard.html"
           style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
          Open Dashboard
        </a>
      </div>`
    ),

  templateRejected: (to: string, name: string, templateTitle: string, reason: string) =>
    send(
      to,
      'Your template was not approved — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#ef4444;margin-bottom:4px">Template Not Approved</h2>
          <p style="color:#6b7280;margin-top:0">Hi ${name}, your template was reviewed and could not be approved at this time.</p>
          <div style="background:#fef2f2;border-radius:8px;padding:16px;margin:20px 0;border:1px solid #fecaca">
            <div style="font-size:0.85rem;color:#6b7280;margin-bottom:4px">Template</div>
            <div style="font-weight:700;color:#111;margin-bottom:12px">${templateTitle}</div>
            <div style="font-size:0.85rem;color:#6b7280;margin-bottom:4px">Reason</div>
            <div style="font-weight:600;color:#ef4444">${reason}</div>
          </div>
          <p style="font-size:0.85rem;color:#6b7280;line-height:1.6">
            Please address the issue above and resubmit your template from your dashboard.
            Our team reviews all submissions carefully to maintain quality standards.
          </p>
          <a href="${BASE}/dashboard.html#upload"
             style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
            Resubmit Template
          </a>
        </div>
      </div>`
    ),

  welcome: (to: string, name: string) =>
    send(
      to,
      'Welcome to FLOWVA 🎬',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2 style="color:#7c3aed">Welcome, ${name}! 🎉</h2>
        <p>You're now part of FLOWVA — the global marketplace for motion graphics.</p>
        <a href="${BASE}/marketplace.html"
           style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
          Explore Marketplace
        </a>
      </div>`
    ),

  saleMade: (
    to: string,
    creatorName: string,
    templateTitle: string,
    grossAmount: number,
    creatorEarning: number,
    currency: string,
  ) =>
    send(
      to,
      `You just made a sale — FLOWVA`,
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed;margin-bottom:4px">💰 New Sale!</h2>
          <p style="color:#6b7280;margin-top:0">Hi ${creatorName}, someone just bought your template.</p>
          <div style="background:#f5f3ff;border-radius:8px;padding:16px;margin:20px 0">
            <div style="font-size:0.85rem;color:#6b7280">Template</div>
            <div style="font-weight:700;color:#111;margin-bottom:12px">${templateTitle}</div>
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
              <div>
                <div style="font-size:0.75rem;color:#6b7280">Sale price</div>
                <div style="font-weight:700;color:#111">${currency} ${grossAmount.toFixed(2)}</div>
              </div>
              <div>
                <div style="font-size:0.75rem;color:#6b7280">Your earnings (70%)</div>
                <div style="font-weight:700;color:#7c3aed">${currency} ${creatorEarning.toFixed(2)}</div>
              </div>
            </div>
          </div>
          <p style="font-size:0.85rem;color:#6b7280">
            Your earnings have been sent directly to your Solana USDC wallet via Helio.
            Open your exchange app to convert to local currency and withdraw to your bank or mobile money.
          </p>
          <a href="${BASE}/dashboard.html#earnings"
             style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
            View Earnings
          </a>
        </div>
      </div>`
    ),

  adminCommissionAlert: (
    to: string,
    commissionAmount: number,
    grossAmount: number,
    currency: string,
    orderId: string,
    templateTitle: string,
  ) =>
    send(
      to,
      `Commission received — FLOWVA`,
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed;margin-bottom:4px">🏦 Commission Incoming</h2>
          <p style="color:#6b7280;margin-top:0">A template was just purchased on FLOWVA.</p>
          <div style="background:#f5f3ff;border-radius:8px;padding:16px;margin:20px 0">
            <div style="font-size:0.85rem;color:#6b7280;margin-bottom:4px">Template</div>
            <div style="font-weight:700;color:#111;margin-bottom:12px">${templateTitle}</div>
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
              <div>
                <div style="font-size:0.75rem;color:#6b7280">Gross sale</div>
                <div style="font-weight:700;color:#111">${currency} ${grossAmount.toFixed(2)}</div>
              </div>
              <div>
                <div style="font-size:0.75rem;color:#6b7280">Your commission (30%)</div>
                <div style="font-weight:700;color:#10b981">${currency} ${commissionAmount.toFixed(2)}</div>
              </div>
            </div>
          </div>
          <p style="font-size:0.8rem;color:#6b7280">Order ID: ${orderId}</p>
          <p style="font-size:0.85rem;color:#6b7280">
            Your commission has been sent on-chain directly to the platform Phantom wallet by Helio.
          </p>
          <a href="${BASE}/admin.html#commissions"
             style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
            View Commissions
          </a>
        </div>
      </div>`
    ),

  projectDelivered: (to: string, projectTitle: string, note: string) =>
    send(to, 'Your project has been delivered — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2 style="color:#7c3aed">Project Delivered 📦</h2>
        <p>Your project <strong>${projectTitle}</strong> has been delivered.</p>
        <p style="background:#f5f3ff;padding:16px;border-radius:8px">${note}</p>
        <a href="${BASE}/dashboard.html#projects"
           style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
          Review Delivery
        </a>
      </div>`),

  disputeOpened: (to: string, projectTitle: string, reason: string, isAdmin = false) =>
    send(to, `Dispute opened — FLOWVA`,
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2 style="color:#ef4444">⚠️ Dispute Opened</h2>
        <p>${isAdmin ? 'A dispute has been opened on' : 'A dispute has been opened on your project'} <strong>${projectTitle}</strong>.</p>
        <p style="background:#fef2f2;padding:16px;border-radius:8px;color:#ef4444">${reason}</p>
        <a href="${BASE}/${isAdmin ? 'admin.html' : 'dashboard.html#projects'}"
           style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
          ${isAdmin ? 'Review Dispute' : 'View Project'}
        </a>
      </div>`),

  projectDeleted: (to: string, name: string) =>
    send(
      to,
      'Your project has been removed — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2 style="color:#ef4444">Project Removed</h2>
        <p>Hi ${name},</p>
        <p>Your project has been permanently removed by the admin team for violating our platform guidelines.</p>
        <p style="font-size:0.85rem;color:#6b7280">If you believe this was a mistake, please contact support.</p>
      </div>`
    ),
};