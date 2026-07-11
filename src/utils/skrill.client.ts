import crypto from 'crypto';

const SKRILL_PAY_URL   = 'https://pay.skrill.com/';
const MERCHANT_EMAIL   = process.env.SKRILL_MERCHANT_EMAIL!;
const SECRET_WORD      = process.env.SKRILL_SECRET_WORD!;

// Skrill's status_url signature = MD5( merchant_id/email + transaction_id +
// MD5(secret_word).toUpperCase() + mb_amount + mb_currency + status ), all
// uppercased. VERIFY THIS against your Skrill merchant Developer Settings
// docs before relying on it in production — Skrill has varied this scheme
// across account types/API versions historically.
function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

export const skrillClient = {

  /**
   * Builds a redirect URL to Skrill's hosted Quick Checkout page.
   * Mirrors paystackClient.initializeTransaction()'s return shape so the
   * calling service can treat both providers identically.
   */
  buildCheckoutUrl(data: {
    transactionId: string;     // our own reference, e.g. FLW_<orderId>
    amount: number;            // major units, e.g. 49.99
    currency: string;
    buyerEmail: string;
    returnUrl: string;         // success redirect (payment-callback.html)
    cancelUrl: string;         // buyer-cancelled redirect
    statusUrl: string;         // our webhook endpoint, server-to-server
    description: string;
  }): { authorizationUrl: string; reference: string } {
    const params = new URLSearchParams({
      pay_to_email:  MERCHANT_EMAIL,
      transaction_id: data.transactionId,
      amount:        data.amount.toFixed(2),
      currency:      data.currency.toUpperCase(),
      pay_from_email: data.buyerEmail,
      return_url:    data.returnUrl,
      cancel_url:    data.cancelUrl,
      status_url:    data.statusUrl,
      detail1_description: 'FLOWVA order',
      detail1_text:  data.description.slice(0, 240),
    });

    return {
      authorizationUrl: `${SKRILL_PAY_URL}?${params.toString()}`,
      reference:        data.transactionId,
    };
  },

  /**
   * Verifies the MD5 signature Skrill sends on its status_url webhook POST.
   * `body` is the parsed application/x-www-form-urlencoded payload Skrill
   * posts (transaction_id, mb_amount, mb_currency, status, md5sig, ...).
   */
  verifyWebhookSignature(body: Record<string, string>): boolean {
    if (!body.md5sig) return false;
    const secretHash = md5(SECRET_WORD).toUpperCase();
    const expected = md5(
      MERCHANT_EMAIL +
      body.transaction_id +
      secretHash +
      body.mb_amount +
      body.mb_currency +
      body.status
    ).toUpperCase();
    return expected === body.md5sig.toUpperCase();
  },
};