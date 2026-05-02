jest.mock('../../models/Agreement');
jest.mock('../../models/Property');
jest.mock('../../models/User');
jest.mock('../../models/AgreementTemplate');
jest.mock('../../utils/emailService', () => ({ sendEmail: jest.fn() }));
jest.mock('../../utils/pdfGenerator', () => ({
  generateAgreementPDF: jest.fn(),
  generateAgreementPDFBuffer: jest.fn(),
}));
jest.mock('../../utils/s3Service', () => ({
  uploadAgreementPDF: jest.fn(),
  isS3Configured: jest.fn().mockReturnValue(false),
  getAgreementPDFStream: jest.fn(),
}));
jest.mock('../../utils/agreementVersionHistory', () => ({
  appendVersionSnapshot: jest.fn().mockResolvedValue(1),
  saveVersionSnapshot: jest.fn(),
}));

const Agreement = require('../../models/Agreement');
const Property = require('../../models/Property');
const User = require('../../models/User');
const AgreementTemplate = require('../../models/AgreementTemplate');
const { appendVersionSnapshot } = require('../../utils/agreementVersionHistory');
const { createAgreement } = require('../../controllers/agreementController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('createAgreement', () => {
  beforeEach(() => {
    User.findById = jest.fn().mockResolvedValue({ _id: 'tenant1', role: 'tenant' });
    Property.findById = jest.fn().mockResolvedValue({ _id: 'property1', landlord: 'landlord1' });
    AgreementTemplate.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    Agreement.create = jest.fn().mockResolvedValue({ _id: 'agreement1', save: jest.fn() });
  });

  it('creates an agreement and stores an initial version snapshot', async () => {
    const res = mockRes();
    const req = {
      body: {
        tenantId: 'tenant1',
        propertyId: 'property1',
        startDate: '2026-06-01',
        endDate: '2027-06-01',
        rentAmount: 1500,
        depositAmount: 3000,
      },
      user: { _id: 'landlord1', subscriptionTier: 'enterprise' },
    };

    await createAgreement(req, res);

    expect(Agreement.create).toHaveBeenCalledWith(expect.objectContaining({
      landlord: 'landlord1',
      tenant: 'tenant1',
      property: 'property1',
    }));
    expect(appendVersionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'agreement1' }),
      'landlord1',
      'Initial snapshot on agreement creation'
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});