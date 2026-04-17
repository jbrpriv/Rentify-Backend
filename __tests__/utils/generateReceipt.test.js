jest.resetModules();

// Mock Puppeteer so tests don't try to launch a real browser.
const mockPuppeteer = (() => {
  let lastHtml = '';
  return {
    executablePath: jest.fn(() => '/fake/chrome'),
    launch: jest.fn(async () => ({
      newPage: async () => ({
        setContent: async (html, opts) => { lastHtml = html; },
        pdf: async (opts) => Buffer.from(lastHtml, 'utf8'),
      }),
      close: async () => {},
    })),
  };
})();

jest.mock('puppeteer', () => mockPuppeteer);
jest.mock('puppeteer-core', () => mockPuppeteer);

// Prevent DB queries for templates and branding/currency lookups
jest.mock('../../models/AgreementTemplate', () => ({
  findOne: jest.fn(() => ({ sort: () => ({ lean: async () => null }) })),
}));

jest.mock('../../utils/currencyService', () => ({
  getCurrencyContext: async () => ({ money: (amt) => `$${Number(amt).toFixed(2)}`, currency: 'USD', rate: 1 }),
}));

jest.mock('../../utils/platformSettings', () => ({
  getPlatformBranding: async () => ({ brandName: 'TestBrand' }),
}));

const { generateReceiptPDFBuffer } = require('../../utils/pdfGenerator');

describe('generateReceiptPDFBuffer', () => {
  it('renders a receipt containing provided receipt number, amount, tenant and branding', async () => {
    const payment = {
      _id: 'pay-1',
      amount: 100,
      receiptNumber: 'REC-123',
      paidAt: new Date('2026-04-16T00:00:00Z'),
      createdAt: new Date().toISOString(),
      landlord: { name: 'Alice', _id: 'land1' },
    };

    const tenant = { name: 'Bob' };
    const property = { title: 'Sunset Apt', landlord: 'land1' };

    const buffer = await generateReceiptPDFBuffer(payment, tenant, property, { currency: 'USD' });
    expect(Buffer.isBuffer(buffer)).toBe(true);

    const html = buffer.toString('utf8');

    // Basic checks that the fallback receipt contains our values
    expect(html).toContain('PAYMENT RECEIPT');
    expect(html).toContain('REC-123');
    expect(html).toContain('$100');
    expect(html).toContain('TestBrand');
    expect(html).toContain('Bob');
    expect(html).toContain('Sunset Apt');
  });
});
