import { AppError } from '../middleware/errorHandler.js';

// ── Commission ─────────────────────────────────────────────────────────────
// Standard: creator keeps 80% (platform takes 20%).
// Early adopter (first N creators, see EARLY_ADOPTER_LIMIT): creator keeps 90%.
export function getCommissionRate(isEarlyAdopter: boolean): number {
  if (isEarlyAdopter) return parseFloat(process.env.EARLY_ADOPTER_COMMISSION_RATE || '0.10');
  return parseFloat(process.env.PLATFORM_COMMISSION_RATE || '0.20');
}

// ── Buyer checkout routing ────────────────────────────────────────────────
// Ghana buyers pay via Paystack. Every other Flowva-supported country pays
// via Skrill Quick Checkout, provided that country is in Skrill's coverage.
export type CheckoutProvider = 'PAYSTACK' | 'SKRILL';

export const PAYSTACK_CHECKOUT_COUNTRIES = (process.env.PAYSTACK_CHECKOUT_COUNTRIES || 'GH')
  .split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

// Everything Flowva supports that Skrill also supports. Skrill's hard
// exclusion list (AF, CU, ER, IR, IQ, JP, KG, LY, KP, SD, SS, SY) contains
// none of Flowva's supported countries as of the last check — revisit if
// Flowva's country list grows.
export const SKRILL_CHECKOUT_COUNTRIES = (process.env.SKRILL_CHECKOUT_COUNTRIES ||
  'DZ,EG,ET,KE,LS,MG,MW,MU,MA,MZ,NG,SN,ZA,TZ,UG,ZM,ZW,' +
  'US,CA,BR,MX,AR,CL,PE,' +
  'AT,BE,FR,DE,IT,NL,NO,PL,ES,SE,CH,GB,' +
  'AU,CN,IN,MY,NZ,SG,TH,VN,' +
  'IL,KW,QA,SA,TR,AE'
).split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

export function resolveCheckoutProvider(buyerCountry: string): CheckoutProvider {
  const c = (buyerCountry || '').toUpperCase();
  if (PAYSTACK_CHECKOUT_COUNTRIES.includes(c)) return 'PAYSTACK';
  if (SKRILL_CHECKOUT_COUNTRIES.includes(c))   return 'SKRILL';
  throw new AppError('Checkout is not yet available for your country. Please contact support.', 400);
}

// ── Paystack currency / payout-country support (unchanged) ─────────────────
export const PAYSTACK_SUPPORTED_CURRENCIES = (process.env.PAYSTACK_SUPPORTED_CURRENCIES || 'GHS,NGN,ZAR,USD')
  .split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

export function isPaystackCurrency(code: string): boolean {
  return PAYSTACK_SUPPORTED_CURRENCIES.includes(code.toUpperCase());
}

// Countries where a creator can set up the Paystack payout method (needs
// Paystack bank-resolution + transfer-recipient support for that country).
export const PAYSTACK_PAYOUT_COUNTRIES = (process.env.PAYSTACK_PAYOUT_COUNTRIES || 'GH,NG')
  .split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

// Paystack expects amounts in the smallest currency unit (kobo/pesewas/
// cents) — correct for every currency in the supported list above, all
// 2-decimal. Revisit if a zero-decimal currency is ever added.
export function toSubunit(amount: number): number {
  return Math.round(amount * 100);
}

// ── Skrill currency support ─────────────────────────────────────────────────
// Skrill supports 40+ currencies on a Full Merchant Account — confirm the
// exact enabled list in your Skrill merchant dashboard and adjust this env
// var; no code change needed if it differs.
export const SKRILL_SUPPORTED_CURRENCIES = (process.env.SKRILL_SUPPORTED_CURRENCIES ||
  'USD,EUR,GBP,NGN,KES,ZAR,CAD,AUD,INR,SGD'
).split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

export function isSkrillCurrency(code: string): boolean {
  return SKRILL_SUPPORTED_CURRENCIES.includes(code.toUpperCase());
}