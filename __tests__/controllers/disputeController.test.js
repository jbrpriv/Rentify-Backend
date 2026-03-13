jest.mock('../../models/Dispute');
jest.mock('../../models/Agreement');

const Dispute = require('../../models/Dispute');
const Agreement = require('../../models/Agreement');

const {
  fileDispute,
  getDisputes,
  getDisputeById,
  updateDispute,
  addComment,
} = require('../../controllers/disputeController');

// ── Helpers ───────────────────────────────────────────────────────────────────
const mockRes = () => {
  const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r;
};
const mockReq = (body = {}, user = {}, extras = {}) => ({
  body, params: {}, query: {},
  user: { _id: 'tenant1', role: 'tenant', ...user },
  ...extras,
});

const TENANT_ID = 'tenant1';
const LANDLORD_ID = 'landlord1';

/**
 * Creates a mock query object whose .populate() always returns itself,
 * and which is thenable so `await chain` resolves to `value`.
 *
 * This matches the pattern:
 *   await Model.findById(id).populate(...).populate(...).populate(...)
 */
const makeThenable = (value) => {
  const chain = {};
  chain.populate = jest.fn().mockReturnValue(chain);
  chain.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
  return chain;
};

// ── fileDispute ───────────────────────────────────────────────────────────────
describe('fileDispute', () => {
  const makeAgreement = () => ({
    _id: 'agr1',
    tenant: { _id: TENANT_ID, toString: () => TENANT_ID },
    landlord: { _id: LANDLORD_ID, toString: () => LANDLORD_ID },
    property: { _id: 'prop1', title: 'Sunset Apt' },
  });

  beforeEach(() => {
    Agreement.findById = jest.fn().mockReturnValue(makeThenable(makeAgreement()));
    Dispute.create = jest.fn().mockResolvedValue({ _id: 'disp1' });
    Agreement.findByIdAndUpdate = jest.fn().mockResolvedValue({});
    Dispute.findById = jest.fn().mockReturnValue(makeThenable({
      _id: 'disp1', filedBy: {}, against: {}, property: {},
    }));
  });

  it('creates a dispute when the caller is the tenant party', async () => {
    const res = mockRes();
    const req = mockReq(
      { agreementId: 'agr1', title: 'Deposit not returned', description: 'Details' },
      { _id: TENANT_ID },
    );
    await fileDispute(req, res);
    expect(Dispute.create).toHaveBeenCalledWith(expect.objectContaining({
      agreement: 'agr1',
      filedBy: TENANT_ID,
      against: LANDLORD_ID,
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('creates a dispute when the caller is the landlord party', async () => {
    const res = mockRes();
    const req = mockReq(
      { agreementId: 'agr1', title: 'Unpaid rent', description: 'Details' },
      { _id: LANDLORD_ID },
    );
    await fileDispute(req, res);
    expect(Dispute.create).toHaveBeenCalledWith(expect.objectContaining({
      filedBy: LANDLORD_ID,
      against: TENANT_ID,
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('links the dispute to the agreement after creation', async () => {
    const res = mockRes();
    const req = mockReq({ agreementId: 'agr1', title: 'T', description: 'D' }, { _id: TENANT_ID });
    await fileDispute(req, res);
    expect(Agreement.findByIdAndUpdate).toHaveBeenCalledWith('agr1', { dispute: 'disp1' });
  });

  it('defaults category to "other" when not provided', async () => {
    const res = mockRes();
    const req = mockReq({ agreementId: 'agr1', title: 'T', description: 'D' }, { _id: TENANT_ID });
    await fileDispute(req, res);
    expect(Dispute.create).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'other' }),
    );
  });

  it('returns 403 when the caller is not a party to the agreement', async () => {
    const res = mockRes();
    const req = mockReq({ agreementId: 'agr1', title: 'T', description: 'D' }, { _id: 'unrelated' });
    await fileDispute(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(Dispute.create).not.toHaveBeenCalled();
  });

  it('returns 404 when the agreement does not exist', async () => {
    Agreement.findById = jest.fn().mockReturnValue(makeThenable(null));
    const res = mockRes();
    const req = mockReq({ agreementId: 'nope', title: 'T', description: 'D' }, { _id: TENANT_ID });
    await fileDispute(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 on unexpected database error', async () => {
    Dispute.create = jest.fn().mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    const req = mockReq({ agreementId: 'agr1', title: 'T', description: 'D' }, { _id: TENANT_ID });
    await fileDispute(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── getDisputes ───────────────────────────────────────────────────────────────
describe('getDisputes', () => {
  const makeChain = (results) => ({
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(results),
  });

  it('scopes by filedBy/against for a tenant', async () => {
    Dispute.find = jest.fn().mockReturnValue(makeChain([]));
    Dispute.countDocuments = jest.fn().mockResolvedValue(0);
    const res = mockRes();
    await getDisputes(mockReq({}, { _id: TENANT_ID, role: 'tenant' }, { query: {} }), res);
    const filter = Dispute.find.mock.calls[0][0];
    expect(filter.$or).toBeDefined();
  });

  it('returns all disputes for an admin (no $or scope)', async () => {
    const disputes = [{ _id: 'd1' }, { _id: 'd2' }];
    Dispute.find = jest.fn().mockReturnValue(makeChain(disputes));
    Dispute.countDocuments = jest.fn().mockResolvedValue(2);
    const res = mockRes();
    await getDisputes(mockReq({}, { _id: 'admin1', role: 'admin' }, { query: {} }), res);
    const filter = Dispute.find.mock.calls[0][0];
    expect(filter).not.toHaveProperty('$or');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ disputes }));
  });

  it('applies an optional status filter from query params', async () => {
    Dispute.find = jest.fn().mockReturnValue(makeChain([]));
    Dispute.countDocuments = jest.fn().mockResolvedValue(0);
    const res = mockRes();
    await getDisputes(mockReq({}, { role: 'admin' }, { query: { status: 'open' } }), res);
    const filter = Dispute.find.mock.calls[0][0];
    expect(filter.status).toBe('open');
  });

  it('returns pagination metadata', async () => {
    Dispute.find = jest.fn().mockReturnValue(makeChain([]));
    Dispute.countDocuments = jest.fn().mockResolvedValue(5);
    const res = mockRes();
    await getDisputes(mockReq({}, { role: 'admin' }, { query: { page: '1', limit: '20' } }), res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ pagination: expect.objectContaining({ total: 5 }) }),
    );
  });

  it('returns 500 on database error', async () => {
    Dispute.find = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(), limit: jest.fn().mockRejectedValue(new Error('DB')),
    });
    Dispute.countDocuments = jest.fn().mockResolvedValue(0);
    const res = mockRes();
    await getDisputes(mockReq({}, { role: 'admin' }, { query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── getDisputeById ────────────────────────────────────────────────────────────
describe('getDisputeById', () => {
  const disputeDoc = {
    _id: 'disp1',
    filedBy: { _id: TENANT_ID, toString: () => TENANT_ID },
    against: { _id: LANDLORD_ID, toString: () => LANDLORD_ID },
  };

  it('returns the dispute for the tenant who filed it', async () => {
    Dispute.findById = jest.fn().mockReturnValue(makeThenable(disputeDoc));
    const res = mockRes();
    await getDisputeById(
      mockReq({}, { _id: TENANT_ID, role: 'tenant' }, { params: { id: 'disp1' } }),
      res,
    );
    expect(res.json).toHaveBeenCalledWith(disputeDoc);
  });

  it('returns 403 for an unrelated user', async () => {
    Dispute.findById = jest.fn().mockReturnValue(makeThenable(disputeDoc));
    const res = mockRes();
    await getDisputeById(
      mockReq({}, { _id: 'unrelated', role: 'tenant' }, { params: { id: 'disp1' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 404 when dispute does not exist', async () => {
    Dispute.findById = jest.fn().mockReturnValue(makeThenable(null));
    const res = mockRes();
    await getDisputeById(
      mockReq({}, { _id: TENANT_ID }, { params: { id: 'nope' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ── updateDispute ─────────────────────────────────────────────────────────────
describe('updateDispute', () => {
  const makeDoc = () => ({
    _id: 'disp1', status: 'open', resolutionNote: null, resolvedBy: null, resolvedAt: null,
    save: jest.fn().mockResolvedValue(true),
  });

  it('updates status and saves', async () => {
    const doc = makeDoc();
    Dispute.findById = jest.fn()
      .mockResolvedValueOnce(doc)
      .mockReturnValue(makeThenable(doc));
    const res = mockRes();
    await updateDispute(
      mockReq({ status: 'resolved', resolutionNote: 'Settled' }, { _id: 'admin1' }, { params: { id: 'disp1' } }),
      res,
    );
    expect(doc.save).toHaveBeenCalled();
    expect(doc.status).toBe('resolved');
  });

  it('sets resolvedBy and resolvedAt when status becomes "resolved"', async () => {
    const doc = makeDoc();
    Dispute.findById = jest.fn()
      .mockResolvedValueOnce(doc)
      .mockReturnValue(makeThenable(doc));
    const res = mockRes();
    await updateDispute(
      mockReq({ status: 'resolved' }, { _id: 'admin1' }, { params: { id: 'disp1' } }),
      res,
    );
    expect(doc.resolvedBy).toBe('admin1');
    expect(doc.resolvedAt).toBeDefined();
  });

  it('returns 404 when dispute does not exist', async () => {
    Dispute.findById = jest.fn().mockResolvedValue(null);
    const res = mockRes();
    await updateDispute(mockReq({ status: 'open' }, {}, { params: { id: 'nope' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ── addComment ────────────────────────────────────────────────────────────────
describe('addComment', () => {
  const makeDoc = () => ({
    _id: 'disp1',
    filedBy: { toString: () => TENANT_ID },
    against: { toString: () => LANDLORD_ID },
    comments: [],
    save: jest.fn().mockResolvedValue(true),
  });

  it('adds a comment for a party to the dispute', async () => {
    const doc = makeDoc();
    Dispute.findById = jest.fn()
      .mockResolvedValueOnce(doc)
      .mockReturnValue(makeThenable({ ...doc, comments: [{ content: 'My comment' }] }));
    const res = mockRes();
    await addComment(
      mockReq({ content: 'My comment' }, { _id: TENANT_ID }, { params: { id: 'disp1' } }),
      res,
    );
    expect(doc.save).toHaveBeenCalled();
    expect(doc.comments).toHaveLength(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('returns 400 for an empty comment body', async () => {
    const res = mockRes();
    await addComment(
      mockReq({ content: '   ' }, { _id: TENANT_ID }, { params: { id: 'disp1' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/empty/i) }),
    );
  });

  it('returns 403 for a user who is not a party', async () => {
    const doc = makeDoc();
    Dispute.findById = jest.fn().mockResolvedValue(doc);
    const res = mockRes();
    await addComment(
      mockReq({ content: 'Sneaky' }, { _id: 'unrelated', role: 'tenant' }, { params: { id: 'disp1' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('returns 404 when the dispute does not exist', async () => {
    Dispute.findById = jest.fn().mockResolvedValue(null);
    const res = mockRes();
    await addComment(
      mockReq({ content: 'Comment' }, { _id: TENANT_ID }, { params: { id: 'nope' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});