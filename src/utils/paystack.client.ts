import axios from 'axios';

const PAYSTACK_BASE = 'https://api.paystack.co';
const SECRET = process.env.PAYSTACK_SECRET_KEY!;

const client = axios.create({
  baseURL: PAYSTACK_BASE,
  headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
});

export const paystackClient = {
  async initializeTransaction(data: {
    email: string; amount: number; currency: string; reference: string;
    callback_url: string; metadata?: Record<string, any>;
  }) {
    const res = await client.post('/transaction/initialize', data);
    return res.data?.data as { authorization_url: string; access_code: string; reference: string };
  },

  async verifyTransaction(reference: string) {
    const res = await client.get(`/transaction/verify/${encodeURIComponent(reference)}`);
    return res.data?.data;
  },

  async resolveAccountNumber(accountNumber: string, bankCode: string) {
    const res = await client.get('/bank/resolve', {
      params: { account_number: accountNumber, bank_code: bankCode },
    });
    return res.data?.data as { account_number: string; account_name: string };
  },

  async listBanks(country: 'ghana' | 'nigeria' = 'ghana') {
    const res = await client.get('/bank', {
      params: { country, currency: country === 'ghana' ? 'GHS' : 'NGN' },
    });
    return res.data?.data as Array<{ name: string; code: string }>;
  },

  async createTransferRecipient(data: {
    name: string; account_number: string; bank_code: string; currency: string;
  }) {
    const res = await client.post('/transferrecipient', { type: 'nuban', ...data });
    return res.data?.data as { recipient_code: string };
  },

  async initiateTransfer(data: { amount: number; recipient: string; reason: string; reference: string }) {
    const res = await client.post('/transfer', { source: 'balance', ...data });
    return res.data?.data as { status: string; transfer_code: string; reference: string };
  },
};