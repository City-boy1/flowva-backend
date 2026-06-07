// ── Payment configuration ─────────────────────────────────────────────────────
// Only Helio is supported. Paystack removed completely.

export function getCommissionRate(isEarlyAdopter: boolean): number {
  if (isEarlyAdopter) {
    // First 50 creators pay only 10% commission
    return parseFloat(process.env.EARLY_ADOPTER_COMMISSION_RATE || '0.10');
  }
  return parseFloat(process.env.PLATFORM_COMMISSION_RATE || '0.30');
}

export function resolveProvider(): 'HELIO' {
  return 'HELIO';
}