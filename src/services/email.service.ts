import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

const BASE          = process.env.FRONTEND_URL || 'https://flowvamarket.vercel.app';
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_COPY_SUBJECTS = ['You just made a sale', 'Dispute opened'];

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER!,
    pass: process.env.GMAIL_PASS!,
  },
});

async function send(to: string, subject: string, html: string) {
  try {
    const shouldCopyAdmin =
      IS_PRODUCTION &&
      ADMIN_EMAIL &&
      ADMIN_EMAIL !== to &&
      ADMIN_COPY_SUBJECTS.some(s => subject.includes(s));

    const toList = shouldCopyAdmin ? `${to},${ADMIN_EMAIL}` : to;

    const info = await transporter.sendMail({
      from: `"FLOWVA" <${process.env.GMAIL_USER}>`,
      to: toList,
      subject,
      html,
    });

    logger.info('Email sent', { to, subject, messageId: info.messageId });
  } catch (err: any) {
    logger.error('Email send failed', {
      to,
      subject,
      error: err?.message ?? String(err),
    });
  }
}

export const emailService = {

  verifyEmail: (to: string, token: string) => {
    const link = `${BASE}/verify-email.html?token=${token}`;
    return send(to, 'Activate your FLOWVA account',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed;margin-bottom:4px">Activate your account</h2>
          <p style="color:#6b7280">Click the button below to verify your email and activate your FLOWVA account.</p>
          <a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Activate Account
          </a>
          <p style="color:#888;font-size:0.85rem">Link expires in 24 hours. If you didn't sign up, ignore this email.</p>
          <p style="color:#888;font-size:0.75rem">Or copy: ${link}</p>
        </div>
      </div>`
    );
  },

  passwordReset: (to: string, token: string) => {
    const link = `${BASE}/reset-password.html?token=${token}`;
    return send(to, 'Reset your FLOWVA password',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed;margin-bottom:4px">Reset your password</h2>
          <p style="color:#6b7280">Click the button below to set a new password.</p>
          <a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Reset Password
          </a>
          <p style="color:#888;font-size:0.85rem">Link expires in 1 hour. If you didn't request this, ignore this email.</p>
          <p style="color:#888;font-size:0.75rem">Or copy: ${link}</p>
        </div>
      </div>`
    );
  },

  welcome: (to: string, name: string) =>
    send(to, 'Welcome to FLOWVA 🎬',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed">Welcome, ${name}! 🎉</h2>
          <p style="color:#6b7280">You're now part of FLOWVA — the global marketplace for motion graphics.</p>
          <a href="${BASE}/marketplace.html" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Explore Marketplace
          </a>
        </div>
      </div>`
    ),

  orderConfirmation: (to: string, orderId: string, amount: number, currency: string) =>
    send(to, 'Order confirmed — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed">Order Confirmed ✓</h2>
          <p style="color:#6b7280">Your order <strong>${orderId}</strong> of <strong>${currency} ${amount}</strong> is confirmed.</p>
          <a href="${BASE}/dashboard.html" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            View Dashboard
          </a>
        </div>
      </div>`
    ),

  orderDelivered: (to: string, orderId: string) =>
    send(to, 'Your order has been delivered — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed">Order Delivered 📦</h2>
          <p style="color:#6b7280">Order <strong>${orderId}</strong> has been delivered. Please review and approve or request a revision.</p>
          <a href="${BASE}/dashboard.html" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Review Order
          </a>
        </div>
      </div>`
    ),

  saleMade: (to: string, creatorName: string, templateTitle: string, grossAmount: number, creatorEarning: number, currency: string) =>
    send(to, 'You just made a sale — FLOWVA',
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
          <a href="${BASE}/dashboard.html#earnings" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
            View Earnings
          </a>
        </div>
      </div>`
    ),

  salePayoutSent: (to: string, creatorName: string, amount: number, solanaAddress: string) =>
    send(to, 'Your earnings have been sent — FLOWVA',
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
          <a href="${BASE}/dashboard.html#earnings" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
            View Earnings
          </a>
        </div>
      </div>`
    ),

  bidAccepted: (to: string, projectTitle: string) =>
    send(to, 'Your bid was accepted — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed">Bid Accepted 🎉</h2>
          <p style="color:#6b7280">Your bid on <strong>${projectTitle}</strong> was accepted. Log in to get started.</p>
          <a href="${BASE}/dashboard.html" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Open Dashboard
          </a>
        </div>
      </div>`
    ),

  templateRejected: (to: string, name: string, templateTitle: string, reason: string) =>
    send(to, 'Your template was not approved — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#ef4444;margin-bottom:4px">Template Not Approved</h2>
          <p style="color:#6b7280;margin-top:0">Hi ${name}, your template could not be approved at this time.</p>
          <div style="background:#fef2f2;border-radius:8px;padding:16px;margin:20px 0;border:1px solid #fecaca">
            <div style="font-size:0.85rem;color:#6b7280;margin-bottom:4px">Template</div>
            <div style="font-weight:700;color:#111;margin-bottom:12px">${templateTitle}</div>
            <div style="font-size:0.85rem;color:#6b7280;margin-bottom:4px">Reason</div>
            <div style="font-weight:600;color:#ef4444">${reason}</div>
          </div>
          <a href="${BASE}/dashboard.html#upload" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
            Resubmit Template
          </a>
        </div>
      </div>`
    ),

  adminCommissionAlert: (to: string, commissionAmount: number, grossAmount: number, currency: string, orderId: string, templateTitle: string) =>
    send(to, 'Commission received — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed;margin-bottom:4px">🏦 Commission Received</h2>
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
          <a href="${BASE}/admin.html#commissions" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
            View Commissions
          </a>
        </div>
      </div>`
    ),

  projectDelivered: (to: string, projectTitle: string, note: string) =>
    send(to, 'Your project has been delivered — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed">Project Delivered 📦</h2>
          <p style="color:#6b7280">Your project <strong>${projectTitle}</strong> has been delivered.</p>
          <p style="background:#f5f3ff;padding:16px;border-radius:8px;color:#374151">${note}</p>
          <a href="${BASE}/dashboard.html#projects" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Review Delivery
          </a>
        </div>
      </div>`
    ),

  disputeOpened: (to: string, projectTitle: string, reason: string, isAdmin = false) =>
    send(to, 'Dispute opened — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#ef4444">⚠️ Dispute Opened</h2>
          <p style="color:#6b7280">${isAdmin ? 'A dispute has been opened on' : 'A dispute has been opened on your project'} <strong>${projectTitle}</strong>.</p>
          <p style="background:#fef2f2;padding:16px;border-radius:8px;color:#ef4444">${reason}</p>
          <a href="${BASE}/${isAdmin ? 'admin.html' : 'dashboard.html#projects'}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            ${isAdmin ? 'Review Dispute' : 'View Project'}
          </a>
        </div>
      </div>`
    ),

  projectDeleted: (to: string, name: string) =>
    send(to, 'Your project has been removed — FLOWVA',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <h2 style="color:#ef4444">Project Removed</h2>
          <p style="color:#6b7280">Hi ${name},</p>
          <p style="color:#6b7280">Your project has been permanently removed by the admin team for violating our platform guidelines.</p>
          <p style="font-size:0.85rem;color:#9ca3af">If you believe this was a mistake, please contact support.</p>
        </div>
      </div>`
    ),
};