import logger from '../utils/logger.js';

const FROM_EMAIL    = 'iamkojo4@gmail.com';
const FROM_NAME     = 'FLOWVA';
const BASE          = process.env.FRONTEND_URL || 'https://flowvamarket.vercel.app';
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_COPY_SUBJECTS = ['You just made a sale', 'Dispute opened'];

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\n/g, '<br>');
}

async function send(to: string, subject: string, html: string) {
  if (!process.env.BREVO_API_KEY) {
    logger.error('BREVO_API_KEY is not set — email not sent', { to, subject });
    throw new Error('Email service is not configured');
  }
  const shouldCopyAdmin =
    IS_PRODUCTION && ADMIN_EMAIL && ADMIN_EMAIL !== to &&
    ADMIN_COPY_SUBJECTS.some(s => subject.includes(s));
  const toList: { email: string }[] = [{ email: to }];
  if (shouldCopyAdmin) toList.push({ email: ADMIN_EMAIL });
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
    body: JSON.stringify({ sender: { name: FROM_NAME, email: FROM_EMAIL }, to: toList, subject, htmlContent: html }),
  });
  if (!res.ok) {
    const err = await res.text();
    logger.error('Email send failed', { to, subject, status: res.status, error: err });
    throw new Error(`Brevo ${res.status}: ${err}`);
  }
  const data = await res.json() as { messageId?: string };
  logger.info('Email sent', { to, subject, messageId: data.messageId });
}

// ── Shared layout ─────────────────────────────────────────────────────────────
function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d0f14;font-family:'Helvetica Neue',Arial,sans-serif;color:#e2e8f0;font-size:14px;line-height:1.6}
  .shell{max-width:520px;margin:0 auto;padding:32px 16px}
  .header{background:#111827;border-radius:12px 12px 0 0;padding:24px 32px;border-bottom:1px solid #1f2937;display:flex;align-items:center;gap:12px}
  .logo-mark{width:32px;height:32px;background:#3b82f6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;font-weight:800;flex-shrink:0}
  .logo-name{font-size:17px;font-weight:800;color:#f1f5f9;letter-spacing:-0.02em}
  .logo-tagline{font-size:11px;color:#64748b;margin-top:1px}
  .card{background:#111827;border-radius:0 0 12px 12px;padding:32px;border:1px solid #1f2937;border-top:none}
  .card-title{font-size:20px;font-weight:700;color:#f1f5f9;margin-bottom:6px;line-height:1.3}
  .card-sub{font-size:13px;color:#94a3b8;margin-bottom:24px}
  .info-box{background:#1e293b;border-radius:8px;padding:20px;margin:20px 0;border:1px solid #1f2937}
  .info-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1f2937}
  .info-row:last-child{border-bottom:none;padding-bottom:0}
  .info-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em}
  .info-value{font-size:14px;font-weight:600;color:#f1f5f9}
  .info-value.accent{color:#3b82f6}
  .info-value.green{color:#10b981}
  .info-value.red{color:#ef4444}
  .info-value.yellow{color:#f59e0b}
  .cta{display:inline-block;background:#3b82f6;color:#fff!important;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;font-size:14px;margin-top:20px;letter-spacing:0.01em}
  .cta:hover{background:#2563eb}
  .cta-danger{background:#ef4444}
  .cta-danger:hover{background:#dc2626}
  .divider{height:1px;background:#1f2937;margin:20px 0}
  .note{font-size:12px;color:#475569;line-height:1.6;margin-top:16px}
  .footer{margin-top:24px;text-align:center;font-size:11px;color:#374151;line-height:1.7}
  .footer a{color:#3b82f6;text-decoration:none}
  .role-badge{display:inline-block;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em}
  .role-buyer{background:#1e2a3a;color:#60a5fa}
  .role-creator{background:#1a2e1a;color:#34d399}
  .role-admin{background:#2a1a2e;color:#a78bfa}
  .status-ok{color:#10b981}
  .status-warn{color:#f59e0b}
  @media only screen and (max-width:480px){
  .shell{padding:16px 8px}
  .header{padding:16px}
  .card{padding:20px 16px}
  .info-row{flex-direction:column;align-items:flex-start;gap:4px;padding:10px 0}
  .info-label{margin-bottom:2px}
  .cta{display:block;text-align:center;width:100%!important;box-sizing:border-box}
  .card-title{font-size:17px}
  .info-value{font-size:13px;word-break:break-word}
}
</style></head>
<body><div class="shell">
  <div class="header">
    <div class="logo-mark">⚡</div>
    <div><div class="logo-name">FLOWVA</div><div class="logo-tagline">Motion Graphics Marketplace</div></div>
  </div>
  <div class="card">${content}</div>
  <div class="footer">
    You received this because you have a FLOWVA account.<br>
    <a href="${BASE}">Visit FLOWVA</a> &middot; <a href="${BASE}/settings.html">Manage notifications</a><br><br>
    &copy; ${new Date().getFullYear()} FLOWVA &mdash; All rights reserved
  </div>
</div></body></html>`;
}

export const emailService = {

  verifyEmail: (to: string, token: string) => {
    const link = `${BASE}/verify-email.html?token=${token}`;
    return send(to, 'Activate your FLOWVA account', layout(`
      <div class="card-title">Verify your email address</div>
      <div class="card-sub">You're one step away from joining FLOWVA.</div>
      <p style="color:#94a3b8;font-size:13px">Click the button below to activate your account. This link expires in <strong style="color:#f1f5f9">24 hours</strong>.</p>
      <a href="${link}" class="cta">Activate Account →</a>
      <div class="divider"></div>
      <p class="note">If you didn't create an account, you can safely ignore this email. Someone may have entered your address by mistake.</p>
      <p class="note" style="margin-top:8px;word-break:break-all">Or copy this link: <a href="${link}" style="color:#3b82f6">${link}</a></p>
    `));
  },

  passwordReset: (to: string, token: string) => {
    const link = `${BASE}/reset-password.html?token=${token}`;
    return send(to, 'Reset your FLOWVA password', layout(`
      <div class="card-title">Password reset request</div>
      <div class="card-sub">We received a request to reset your password.</div>
      <p style="color:#94a3b8;font-size:13px">Click the button below to set a new password. This link expires in <strong style="color:#f1f5f9">1 hour</strong>.</p>
      <a href="${link}" class="cta">Reset Password →</a>
      <div class="divider"></div>
      <p class="note">If you didn't request a password reset, ignore this email — your account is safe. Your password won't change until you click the link above and create a new one.</p>
    `));
  },

  welcome: (to: string, name: string) =>
    send(to, 'Welcome to FLOWVA 🎬', layout(`
      <div class="card-title">Welcome aboard, ${name}! 🎉</div>
      <div class="card-sub">You're now part of the FLOWVA community.</div>
      <p style="color:#94a3b8;font-size:13px">FLOWVA is the global marketplace for motion graphics — browse thousands of templates, hire top creators, or start selling your own work today.</p>
      <div class="info-box" style="margin-top:24px">
        <div class="info-row"><span class="info-label">Browse</span><span class="info-value">Thousands of premium templates</span></div>
        <div class="info-row"><span class="info-label">Sell</span><span class="info-value">Earn 70% on every sale</span></div>
        <div class="info-row"><span class="info-label">Hire</span><span class="info-value">Post projects, get bids</span></div>
      </div>
      <a href="${BASE}/marketplace.html" class="cta">Explore Marketplace →</a>
    `)),

  orderConfirmation: (to: string, orderId: string, amount: number, currency: string) =>
    send(to, 'Order confirmed — FLOWVA', layout(`
      <div class="card-title">Order confirmed ✓</div>
      <div class="card-sub">Your payment was received successfully.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Order ID</span><span class="info-value accent">${orderId.slice(-10).toUpperCase()}</span></div>
        <div class="info-row"><span class="info-label">Amount paid</span><span class="info-value green">${currency} ${amount.toFixed(2)}</span></div>
        <div class="info-row"><span class="info-label">Status</span><span class="info-value status-ok">✓ Confirmed</span></div>
      </div>
      <a href="${BASE}/dashboard.html" class="cta">View Dashboard →</a>
    `)),

  orderDelivered: (to: string, orderId: string) =>
    send(to, 'Your order has been delivered — FLOWVA', layout(`
      <div class="card-title">Order delivered 📦</div>
      <div class="card-sub">Your creator has submitted a delivery. Please review it.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Order ID</span><span class="info-value accent">${orderId.slice(-10).toUpperCase()}</span></div>
        <div class="info-row"><span class="info-label">Action required</span><span class="info-value status-warn">⏳ Awaiting your review</span></div>
      </div>
      <p style="color:#94a3b8;font-size:13px;margin-top:4px">Approve the delivery to release payment to the creator, or request a revision if something needs to change.</p>
      <a href="${BASE}/dashboard.html" class="cta">Review Delivery →</a>
      <p class="note">If you don't respond within 7 days, the delivery will be auto-approved and payment released to the creator.</p>
    `)),

  saleMade: (to: string, creatorName: string, templateTitle: string, grossAmount: number, creatorEarning: number, currency: string) =>
    send(to, 'You just made a sale — FLOWVA', layout(`
      <div class="card-title">💰 New sale!</div>
      <div class="card-sub">Hi ${creatorName}, someone just purchased your template.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Template</span><span class="info-value">${templateTitle}</span></div>
        <div class="info-row"><span class="info-label">Sale price</span><span class="info-value">${currency} ${grossAmount.toFixed(2)}</span></div>
        <div class="info-row"><span class="info-label">Your earnings (70%)</span><span class="info-value green">${currency} ${creatorEarning.toFixed(2)}</span></div>
        <div class="info-row"><span class="info-label">Platform fee (30%)</span><span class="info-value" style="color:#64748b">${currency} ${(grossAmount - creatorEarning).toFixed(2)}</span></div>
      </div>
      <p style="color:#94a3b8;font-size:13px">Your earnings have been credited to your wallet and will be paid out via Helio on-chain.</p>
      <a href="${BASE}/dashboard.html#earnings" class="cta">View Earnings →</a>
    `)),

  salePayoutSent: (to: string, creatorName: string, amount: number, solanaAddress: string) =>
    send(to, 'Your earnings have been sent — FLOWVA', layout(`
      <div class="card-title">💸 Earnings sent</div>
      <div class="card-sub">Hi ${creatorName}, your USDC has been sent on-chain.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Amount</span><span class="info-value green">USDC ${amount.toFixed(2)}</span></div>
        <div class="info-row"><span class="info-label">Network</span><span class="info-value">Solana</span></div>
        <div class="info-row"><span class="info-label">Destination</span><span class="info-value accent" style="font-size:11px;word-break:break-all">${solanaAddress}</span></div>
        <div class="info-row"><span class="info-label">Status</span><span class="info-value status-ok">✓ Sent</span></div>
      </div>
      <p class="note">Funds typically arrive within minutes on Solana. Check your exchange app (Binance, Monica, Coinbase) to see the incoming USDC.</p>
      <a href="${BASE}/dashboard.html#earnings" class="cta">View Earnings History →</a>
    `)),

  bidAccepted: (to: string, projectTitle: string) =>
    send(to, 'Your bid was accepted — FLOWVA', layout(`
      <div class="card-title">Bid accepted 🎉</div>
      <div class="card-sub">Congratulations — a client has chosen you for this project.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Project</span><span class="info-value">${projectTitle}</span></div>
        <div class="info-row"><span class="info-label">Status</span><span class="info-value status-ok">✓ Bid accepted</span></div>
      </div>
      <p style="color:#94a3b8;font-size:13px">Log in to your dashboard to start the project. Reach out to the client via messages if you need any clarification before beginning.</p>
      <a href="${BASE}/dashboard.html" class="cta">Open Dashboard →</a>
    `)),

  templateRejected: (to: string, name: string, templateTitle: string, reason: string) =>
    send(to, 'Your template was not approved — FLOWVA', layout(`
      <div class="card-title">Template not approved</div>
      <div class="card-sub">Hi ${name}, we reviewed your submission and couldn't approve it at this time.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Template</span><span class="info-value">${templateTitle}</span></div>
        <div class="info-row"><span class="info-label">Decision</span><span class="info-value red">✕ Not approved</span></div>
      </div>
      <div style="background:#1e293b;border-left:3px solid #ef4444;border-radius:0 6px 6px 0;padding:14px 16px;margin:16px 0">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Reason from review team</div>
        div style="color:#fca5a5;font-size:13px;line-height:1.6">${esc(reason)}</div>
      </div>
      <p style="color:#94a3b8;font-size:13px">Address the feedback above, update your template, and resubmit. Our team reviews all submissions within 48 hours.</p>
      <a href="${BASE}/dashboard.html#upload" class="cta">Resubmit Template →</a>
    `)),

  adminCommissionAlert: (to: string, commissionAmount: number, grossAmount: number, currency: string, orderId: string, templateTitle: string) =>
    send(to, 'Commission received — FLOWVA', layout(`
      <div class="card-title">🏦 Commission received</div>
      <div class="card-sub">A template purchase just completed on FLOWVA.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Template</span><span class="info-value">${templateTitle}</span></div>
        <div class="info-row"><span class="info-label">Order ID</span><span class="info-value accent">${orderId.slice(-10).toUpperCase()}</span></div>
        <div class="info-row"><span class="info-label">Gross sale</span><span class="info-value">${currency} ${grossAmount.toFixed(2)}</span></div>
        <div class="info-row"><span class="info-label">Your commission (30%)</span><span class="info-value green">${currency} ${commissionAmount.toFixed(2)}</span></div>
        <div class="info-row"><span class="info-label">Creator payout (70%)</span><span class="info-value" style="color:#64748b">${currency} ${(grossAmount - commissionAmount).toFixed(2)}</span></div>
      </div>
      <a href="${BASE}/admin.html#commissions" class="cta">View Commissions →</a>
    `)),

  projectDelivered: (to: string, projectTitle: string, note: string) =>
    send(to, 'Your project has been delivered — FLOWVA', layout(`
      <div class="card-title">Project delivered 📦</div>
      <div class="card-sub">Your creator has submitted their work for review.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Project</span><span class="info-value">${projectTitle}</span></div>
        <div class="info-row"><span class="info-label">Action required</span><span class="info-value status-warn">⏳ Awaiting your review</span></div>
      </div>
      <div style="background:#1e293b;border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;padding:14px 16px;margin:16px 0">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Delivery note from creator</div>
        <div style="color:#cbd5e1;font-size:13px;line-height:1.6">${esc(note)}</div>
      </div>
      <a href="${BASE}/dashboard.html#projects" class="cta">Review Delivery →</a>
    `)),

  disputeOpened: (to: string, projectTitle: string, reason: string, isAdmin = false) =>
    send(to, 'Dispute opened — FLOWVA', layout(`
      <div class="card-title">⚠️ Dispute opened</div>
      <div class="card-sub">${isAdmin ? 'A dispute has been raised and requires your review.' : 'A dispute has been opened on your project.'}</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Project</span><span class="info-value">${projectTitle}</span></div>
        <div class="info-row"><span class="info-label">Status</span><span class="info-value red">⚠ In dispute</span></div>
      </div>
      <div style="background:#1e293b;border-left:3px solid #f59e0b;border-radius:0 6px 6px 0;padding:14px 16px;margin:16px 0">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Reason stated</div>
        <div style="color:#fde68a;font-size:13px;line-height:1.6">${esc(reason)}</div>
      </div>
      ${isAdmin
        ? '<p style="color:#94a3b8;font-size:13px">Review the dispute in the admin panel and decide to either release funds to the creator or refund the buyer.</p>'
        : '<p style="color:#94a3b8;font-size:13px">Our admin team will review the dispute and reach a decision. You may be contacted for more information.</p>'}
      <a href="${BASE}/${isAdmin ? 'admin.html' : 'dashboard.html#projects'}" class="cta ${isAdmin ? 'cta-danger' : ''}">
        ${isAdmin ? 'Review Dispute →' : 'View Project →'}
      </a>
    `)),

  projectDeleted: (to: string, name: string) =>
    send(to, 'Your project has been removed — FLOWVA', layout(`
      <div class="card-title">Project removed</div>
      <div class="card-sub">Hi ${name}, your project has been removed by the FLOWVA team.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Reason</span><span class="info-value red">Policy violation</span></div>
      </div>
      <p style="color:#94a3b8;font-size:13px">Your project was permanently removed for violating our platform guidelines. All associated bids have also been removed.</p>
      <p class="note">If you believe this was a mistake, please contact our support team with your project details and we'll review your case.</p>
      <a href="${BASE}/support.html" class="cta cta-danger">Contact Support →</a>
    `)),

  roleChanged: (to: string, name: string, oldRole: string, newRole: string) =>
    send(to, 'Your account role has been updated — FLOWVA', layout(`
      <div class="card-title">Account role updated</div>
      <div class="card-sub">Hi ${name}, an admin has updated your account role.</div>
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Previous role</span>
          <span class="role-badge role-${oldRole.toLowerCase()}">${oldRole}</span>
        </div>
        <div class="info-row">
          <span class="info-label">New role</span>
          <span class="role-badge role-${newRole.toLowerCase()}">${newRole}</span>
        </div>
      </div>
      ${newRole === 'CREATOR'
        ? `<p style="color:#94a3b8;font-size:13px">You can now upload templates, receive project bids, and earn on the platform. Head to your dashboard to get started.</p>
           <a href="${BASE}/dashboard.html#upload" class="cta">Start Uploading →</a>`
        : `<p style="color:#94a3b8;font-size:13px">Your account has been updated to Buyer status. You can still browse and purchase templates and post projects.</p>
           <a href="${BASE}/marketplace.html" class="cta">Browse Marketplace →</a>`
      }
      <p class="note">If you believe this change was made in error, please contact our support team.</p>
    `)),

    payoutMethodApproved: (to: string, name: string, method: string) =>
    send(to, 'Your payout method has been updated — FLOWVA', layout(`
      <div class="card-title">Payout method updated ✓</div>
      <div class="card-sub">Hi ${name}, your requested payout method change has been approved.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Active method</span><span class="info-value green">${method}</span></div>
        <div class="info-row"><span class="info-label">Status</span><span class="info-value status-ok">✓ Active now</span></div>
      </div>
      <p style="color:#94a3b8;font-size:13px">Future payouts will be sent to this method until you request another change.</p>
      <a href="${BASE}/dashboard.html#payout" class="cta">View Payout Settings →</a>
    `)),

  payoutMethodRejected: (to: string, name: string, method: string, reason: string) =>
    send(to, 'Payout method change not approved — FLOWVA', layout(`
      <div class="card-title">Payout method change not approved</div>
      <div class="card-sub">Hi ${name}, we couldn't approve your request to switch to ${method}.</div>
      <div style="background:#1e293b;border-left:3px solid #ef4444;border-radius:0 6px 6px 0;padding:14px 16px;margin:16px 0">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Reason from review team</div>
        <div style="color:#fca5a5;font-size:13px;line-height:1.6">${esc(reason)}</div>
      </div>
      <p style="color:#94a3b8;font-size:13px">Your current payout method is unchanged. Submit a new request from your dashboard any time.</p>
      <a href="${BASE}/dashboard.html#payout" class="cta">View Payout Settings →</a>
    `)),

    roleRequestSubmitted: (to: string, name: string) =>
    send(to, 'Creator application received — FLOWVA', layout(`
      <div class="card-title">Application received ✓</div>
      <div class="card-sub">Hi ${name}, we've received your request to become a creator.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Status</span><span class="info-value status-warn">⏳ Under review</span></div>
        <div class="info-row"><span class="info-label">Response time</span><span class="info-value">Usually within 48 hours</span></div>
      </div>
      <p style="color:#94a3b8;font-size:13px">Our team will review your application and notify you by email once a decision has been made. You don't need to do anything else right now.</p>
      <a href="${BASE}/dashboard.html" class="cta">Back to Dashboard →</a>
    `)),

  roleRequestRejected: (to: string, name: string, reason: string) =>
    send(to, 'Creator application update — FLOWVA', layout(`
      <div class="card-title">Application not approved</div>
      <div class="card-sub">Hi ${name}, we reviewed your creator application and couldn't approve it at this time.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Decision</span><span class="info-value red">✕ Not approved</span></div>
      </div>
      <div style="background:#1e293b;border-left:3px solid #ef4444;border-radius:0 6px 6px 0;padding:14px 16px;margin:16px 0">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Reason from review team</div>
        <div style="color:#fca5a5;font-size:13px;line-height:1.6">${esc(reason)}</div>
      </div>
      <p style="color:#94a3b8;font-size:13px">You're welcome to reapply once you've addressed the feedback above. Make sure your profile is complete before applying again.</p>
      <a href="${BASE}/dashboard.html" class="cta">View Dashboard →</a>
    `)),

  newRoleRequestAdmin: (to: string, userName: string, userEmail: string, message: string) =>
    send(to, 'New creator application — FLOWVA', layout(`
      <div class="card-title">New creator application 🔔</div>
      <div class="card-sub">A buyer has applied to become a creator on FLOWVA.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Name</span><span class="info-value">${userName}</span></div>
        <div class="info-row"><span class="info-label">Email</span><span class="info-value accent">${userEmail}</span></div>
        <div class="info-row"><span class="info-label">Status</span><span class="info-value status-warn">⏳ Awaiting review</span></div>
      </div>
      ${message ? `
      <div style="background:#1e293b;border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;padding:14px 16px;margin:16px 0">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Applicant's message</div>
       <div style="color:#cbd5e1;font-size:13px;line-height:1.6">${esc(message)}</div>
      </div>` : ''}
      <a href="${BASE}/admin.html#requests" class="cta">Review Application →</a>
    `)),

    contactForm: (name: string, email: string, subject: string, message: string, username?: string) =>
  send(
    process.env.ADMIN_EMAIL || 'flowva3@gmail.com',
    `[Contact] ${subject} — FLOWVA`,
    layout(`
      <div class="card-title">📩 New Contact Message</div>
      <div class="card-sub">Someone submitted the contact form on FLOWVA.</div>
      <div class="info-box">
        <div class="info-row"><span class="info-label">Name</span><span class="info-value">${esc(name)}</span></div>
        <div class="info-row"><span class="info-label">Email</span><span class="info-value accent">${esc(email)}</span></div>
        <div class="info-row"><span class="info-label">Subject</span><span class="info-value">${esc(subject)}</span></div>
        ${username ? `<div class="info-row"><span class="info-label">Username</span><span class="info-value">${esc(username)}</span></div>` : ''}
      </div>
      <div style="background:#1e293b;border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;padding:14px 16px;margin:16px 0">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Message</div>
        <div style="color:#cbd5e1;font-size:13px;line-height:1.6">${esc(message)}</div>
      </div>
      <p class="note">Reply directly to <a href="mailto:${esc(email)}" style="color:#3b82f6">${esc(email)}</a> to respond to this user.</p>
    `)
  ),
};