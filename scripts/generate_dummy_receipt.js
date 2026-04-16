const fs = require('fs');
const path = require('path');
const { generateReceiptPDFBuffer } = require('../utils/pdfGenerator');

(async () => {
  const payment = {
    _id: 'pay-dummy-1',
    amount: 150.5,
    receiptNumber: 'DUMMY-REC-001',
    paidAt: new Date(),
    createdAt: new Date(),
    landlord: { name: 'Dummy Landlord', _id: 'land1' },
  };

  const tenant = { name: 'Dummy Tenant' };
  const property = { title: 'Dummy Property', landlord: 'land1' };

  try {
    const buffer = await generateReceiptPDFBuffer(payment, tenant, property, { currency: 'USD' });
    const outPath = path.resolve(__dirname, '..', 'tmp', `receipt-${payment.receiptNumber || payment._id}.pdf`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buffer);
    console.log('Wrote', outPath);
  } catch (err) {
    console.error('Failed to generate receipt PDF:', err);
    process.exit(1);
  }
})();
