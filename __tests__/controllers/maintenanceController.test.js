jest.mock('../../models/MaintenanceRequest');
jest.mock('../../models/Property');
jest.mock('../../models/Agreement');
jest.mock('../../queues/notificationQueue', () => ({ add: jest.fn().mockResolvedValue(true) }));

const MaintenanceRequest = require('../../models/MaintenanceRequest');
const Property = require('../../models/Property');
const Agreement = require('../../models/Agreement');

const {
  createRequest,
  getRequests,
  getRequestById,
  updateRequest,
  deleteRequest,
} = require('../../controllers/maintenanceController');

// ── Helpers ───────────────────────────────────────────────────────────────────
const mockRes = () => {
  const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r;
};
const mockReq = (body = {}, user = {}, extras = {}) => ({
  body, params: {}, query: {},
  user: { _id: 'tenant1', role: 'tenant', name: 'Tenant', ...user },
  ...extras,
});

/** Build a full Mongoose query chain mock that resolves with `value` */
const chainMock = (value) => {
  const chain = {
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(value),
  };
  return chain;
};

/**
 * Creates a thenable chain for models that use:
 *   await Model.findById(id).populate(...).populate(...).populate(...)
 * Each .populate() returns the same object; awaiting it resolves to `value`.
 */
const makeThenable = (value) => {
  const chain = {};
  chain.populate = jest.fn().mockReturnValue(chain);
  chain.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
  return chain;
};

const landlordDoc = { _id: 'l1', name: 'Landlord', email: 'l@x.com', phoneNumber: '0300', smsOptIn: false };
const propertyDoc = { _id: 'prop1', landlord: landlordDoc, managedBy: null };

// ── createRequest ─────────────────────────────────────────────────────────────
describe('createRequest', () => {
  beforeEach(() => {
    Property.findById = jest.fn().mockReturnValue({
      populate: jest.fn().mockResolvedValue(propertyDoc),
    });
    Agreement.findOne = jest.fn().mockResolvedValue({ _id: 'agr1' }); // active lease exists

    const createdDoc = { _id: 'maint1' };
    MaintenanceRequest.create = jest.fn().mockResolvedValue(createdDoc);
    // findById after create — chains 3 x .populate() then is awaited
    MaintenanceRequest.findById = jest.fn().mockReturnValue(
      makeThenable({ _id: 'maint1', title: 'Tap leak', tenant: {}, landlord: {} })
    );
  });

  it('creates and returns the request with 201 for a tenant with an active lease', async () => {
    const res = mockRes();
    const req = mockReq({ propertyId: 'prop1', title: 'Tap leak', description: 'Drips non-stop' });
    await createRequest(req, res);
    expect(MaintenanceRequest.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('returns 404 when property does not exist', async () => {
    Property.findById = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await createRequest(mockReq({ propertyId: 'nope' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Property not found' });
    expect(MaintenanceRequest.create).not.toHaveBeenCalled();
  });

  it('returns 403 when tenant has no active lease on the property', async () => {
    Agreement.findOne = jest.fn().mockResolvedValue(null); // no active agreement
    const res = mockRes();
    await createRequest(mockReq({ propertyId: 'prop1', title: 'Test' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/active lease/i) }));
    expect(MaintenanceRequest.create).not.toHaveBeenCalled();
  });

  it('sets priority to "medium" when not supplied', async () => {
    const res = mockRes();
    await createRequest(mockReq({ propertyId: 'prop1', title: 'Test', description: 'Desc' }), res);
    const createCall = MaintenanceRequest.create.mock.calls[0][0];
    expect(createCall.priority).toBe('medium');
  });

  it('sets category to "other" when not supplied', async () => {
    const res = mockRes();
    await createRequest(mockReq({ propertyId: 'prop1', title: 'Test', description: 'Desc' }), res);
    const createCall = MaintenanceRequest.create.mock.calls[0][0];
    expect(createCall.category).toBe('other');
  });

  it('returns 500 on unexpected database error', async () => {
    MaintenanceRequest.create = jest.fn().mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    await createRequest(mockReq({ propertyId: 'prop1', title: 'Test' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── getRequests ───────────────────────────────────────────────────────────────
describe('getRequests', () => {
  const setupFind = (results = []) => {
    MaintenanceRequest.find = jest.fn().mockReturnValue(chainMock(results));
    MaintenanceRequest.countDocuments = jest.fn().mockResolvedValue(results.length);
  };

  it('scopes results to the current tenant', async () => {
    setupFind([{ _id: 'm1' }]);
    const res = mockRes();
    await getRequests(mockReq({}, { _id: 'tenant1', role: 'tenant' }, { query: {} }), res);
    const filter = MaintenanceRequest.find.mock.calls[0][0];
    expect(filter.tenant).toBe('tenant1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requests: expect.any(Array) }));
  });

  it('scopes results to the current landlord', async () => {
    setupFind([]);
    const res = mockRes();
    await getRequests(mockReq({}, { _id: 'landlord1', role: 'landlord' }, { query: {} }), res);
    const filter = MaintenanceRequest.find.mock.calls[0][0];
    expect(filter.landlord).toBe('landlord1');
  });

  it("scopes results to the PM's assignedTo field", async () => {
    setupFind([]);
    const res = mockRes();
    await getRequests(mockReq({}, { _id: 'pm1', role: 'property_manager' }, { query: {} }), res);
    const filter = MaintenanceRequest.find.mock.calls[0][0];
    expect(filter.assignedTo).toBe('pm1');
  });

  it('returns all requests for an admin (no role filter)', async () => {
    setupFind([{ _id: 'm1' }, { _id: 'm2' }]);
    const res = mockRes();
    await getRequests(mockReq({}, { _id: 'admin1', role: 'admin' }, { query: {} }), res);
    const filter = MaintenanceRequest.find.mock.calls[0][0];
    expect(filter).not.toHaveProperty('tenant');
    expect(filter).not.toHaveProperty('landlord');
    expect(filter).not.toHaveProperty('assignedTo');
  });

  it('applies an optional status filter from query params', async () => {
    setupFind([]);
    const res = mockRes();
    await getRequests(mockReq({}, { role: 'admin' }, { query: { status: 'open' } }), res);
    const filter = MaintenanceRequest.find.mock.calls[0][0];
    expect(filter.status).toBe('open');
  });

  it('returns paginated metadata in the response', async () => {
    setupFind([{ _id: 'm1' }]);
    const res = mockRes();
    await getRequests(mockReq({}, { role: 'admin' }, { query: { page: '1', limit: '10' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      pagination: expect.objectContaining({ total: expect.any(Number) }),
    }));
  });

  it('returns 500 on database error', async () => {
    MaintenanceRequest.find = jest.fn().mockReturnValue({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockRejectedValue(new Error('DB')) });
    MaintenanceRequest.countDocuments = jest.fn().mockResolvedValue(0);
    const res = mockRes();
    await getRequests(mockReq({}, { role: 'admin' }, { query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── getRequestById ────────────────────────────────────────────────────────────
describe('getRequestById', () => {
  const tenantId = 'tenant1';
  const landlordId = 'landlord1';
  const requestDoc = {
    _id: 'maint1',
    tenant: { _id: tenantId, toString: () => tenantId },
    landlord: { _id: landlordId, toString: () => landlordId },
    assignedTo: null,
  };

  it('returns the request for the tenant who created it', async () => {
    MaintenanceRequest.findById = jest.fn().mockReturnValue(makeThenable(requestDoc));
    const res = mockRes();
    await getRequestById(mockReq({}, { _id: tenantId, role: 'tenant' }, { params: { id: 'maint1' } }), res);
    expect(res.json).toHaveBeenCalledWith(requestDoc);
  });

  it('returns 403 when an unrelated user tries to access the request', async () => {
    MaintenanceRequest.findById = jest.fn().mockReturnValue(makeThenable(requestDoc));
    const res = mockRes();
    await getRequestById(mockReq({}, { _id: 'unrelated', role: 'tenant' }, { params: { id: 'maint1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 404 when request does not exist', async () => {
    MaintenanceRequest.findById = jest.fn().mockReturnValue(makeThenable(null));
    const res = mockRes();
    await getRequestById(mockReq({}, { _id: tenantId, role: 'tenant' }, { params: { id: 'nope' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ── updateRequest ─────────────────────────────────────────────────────────────
describe('updateRequest', () => {
  const requestDoc = () => ({
    _id: 'maint1',
    status: 'open',
    tenant: { _id: 't1', email: 't@x.com', phoneNumber: '0300', name: 'T', smsOptIn: false },
    title: 'Leaking tap',
    statusHistory: [],
    save: jest.fn().mockResolvedValue(true),
  });

  it('updates status and pushes to statusHistory', async () => {
    const doc = requestDoc();
    MaintenanceRequest.findById = jest.fn()
      .mockReturnValueOnce({ populate: jest.fn().mockResolvedValue(doc) }) // first call: fetch
      .mockReturnValue({ populate: jest.fn().mockReturnThis() });          // second: for populated response

    const mockPop = jest.fn().mockReturnThis();
    MaintenanceRequest.findById = jest.fn()
      .mockReturnValueOnce({ populate: jest.fn().mockResolvedValue(doc) })
      .mockReturnValue({ populate: mockPop });
    mockPop.mockResolvedValue(doc);

    const res = mockRes();
    await updateRequest(
      mockReq({ status: 'in_progress', note: 'Started' }, { _id: 'landlord1', role: 'landlord' }, { params: { id: 'maint1' } }),
      res,
    );
    expect(doc.save).toHaveBeenCalled();
    expect(doc.status).toBe('in_progress');
    expect(doc.statusHistory).toHaveLength(1);
  });

  it('sets resolvedAt when status is "resolved"', async () => {
    const doc = requestDoc();
    const mockPop = jest.fn().mockReturnThis();
    MaintenanceRequest.findById = jest.fn()
      .mockReturnValueOnce({ populate: jest.fn().mockResolvedValue(doc) })
      .mockReturnValue({ populate: mockPop });
    mockPop.mockResolvedValue(doc);

    const res = mockRes();
    await updateRequest(
      mockReq({ status: 'resolved' }, { _id: 'l1' }, { params: { id: 'maint1' } }),
      res,
    );
    expect(doc.resolvedAt).toBeDefined();
  });

  it('returns 404 when request does not exist', async () => {
    MaintenanceRequest.findById = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await updateRequest(mockReq({ status: 'open' }, {}, { params: { id: 'nope' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ── deleteRequest ─────────────────────────────────────────────────────────────
describe('deleteRequest', () => {
  it('allows the tenant-owner to delete their own open request', async () => {
    const doc = {
      _id: 'maint1',
      tenant: { toString: () => 'tenant1' },
      status: 'open',
      deleteOne: jest.fn().mockResolvedValue(true),
    };
    MaintenanceRequest.findById = jest.fn().mockResolvedValue(doc);
    const res = mockRes();
    await deleteRequest(mockReq({}, { _id: 'tenant1', role: 'tenant' }, { params: { id: 'maint1' } }), res);
    expect(doc.deleteOne).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Maintenance request deleted' });
  });

  it('allows admin to delete any request', async () => {
    const doc = {
      _id: 'maint1',
      tenant: { toString: () => 'tenant1' },
      status: 'in_progress',
      deleteOne: jest.fn().mockResolvedValue(true),
    };
    MaintenanceRequest.findById = jest.fn().mockResolvedValue(doc);
    const res = mockRes();
    await deleteRequest(mockReq({}, { _id: 'admin1', role: 'admin' }, { params: { id: 'maint1' } }), res);
    expect(doc.deleteOne).toHaveBeenCalled();
  });

  it('returns 403 when a non-admin tries to delete a non-open or unrelated request', async () => {
    const doc = {
      _id: 'maint1',
      tenant: { toString: () => 'tenant1' },
      status: 'in_progress',   // not 'open' — tenant cannot delete
      deleteOne: jest.fn(),
    };
    MaintenanceRequest.findById = jest.fn().mockResolvedValue(doc);
    const res = mockRes();
    await deleteRequest(mockReq({}, { _id: 'tenant1', role: 'tenant' }, { params: { id: 'maint1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(doc.deleteOne).not.toHaveBeenCalled();
  });

  it('returns 404 when request does not exist', async () => {
    MaintenanceRequest.findById = jest.fn().mockResolvedValue(null);
    const res = mockRes();
    await deleteRequest(mockReq({}, {}, { params: { id: 'nope' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});