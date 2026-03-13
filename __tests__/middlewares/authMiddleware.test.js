// resetModules:true means each file gets fresh module instances.
// jest.mock() calls are hoisted before any require, so they intercept
// the very first time 'User' is loaded in this test file.
jest.mock('../../models/User');

const jwt  = require('jsonwebtoken');
const User = require('../../models/User');
const {
  protect,
  requireRole,
  isLandlord,
  isAdmin,
  isTenant,
} = require('../../middlewares/authMiddleware');

// ── Shared helpers ────────────────────────────────────────────────────────────
const mockRes = () => {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json   = jest.fn().mockReturnValue(r);
  return r;
};

const mockReq = (overrides = {}) => ({
  headers: {},
  cookies: {},
  query:   {},
  path:    '/some/path',
  ...overrides,
});

const sign = (payload, secret = process.env.JWT_SECRET) =>
  jwt.sign(payload, secret, { expiresIn: '15m' });

const activeUser = { _id: 'u1', name: 'Alice', role: 'tenant', isActive: true };

// ── protect ───────────────────────────────────────────────────────────────────
describe('protect', () => {
  beforeEach(() => {
    User.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue(activeUser),
    });
  });

  it('calls next() and sets req.user for a valid Bearer token', async () => {
    const token = sign({ id: 'u1' });
    const req   = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res   = mockRes();
    const next  = jest.fn();

    await protect(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(activeUser);
  });

  it('returns 401 when Authorization header is absent', async () => {
    const req  = mockReq();
    const res  = mockRes();
    const next = jest.fn();

    await protect(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/no token/i) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a malformed / tampered token', async () => {
    const req  = mockReq({ headers: { authorization: 'Bearer bad.token.here' } });
    const res  = mockRes();
    const next = jest.fn();

    await protect(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when signed with the wrong secret', async () => {
    const token = sign({ id: 'u1' }, 'wrong-secret');
    const req   = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res   = mockRes();
    const next  = jest.fn();

    await protect(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the user no longer exists in the DB', async () => {
    User.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    });
    const token = sign({ id: 'deleted' });
    const req   = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res   = mockRes();
    const next  = jest.fn();

    await protect(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/user not found/i) }));
  });

  it('returns 403 for a suspended account (isActive=false)', async () => {
    User.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({ ...activeUser, isActive: false }),
    });
    const token = sign({ id: 'u1' });
    const req   = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res   = mockRes();
    const next  = jest.fn();

    await protect(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/suspended/i) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts _token query param on the /oauth/abandon path', async () => {
    const token = sign({ id: 'u1' });
    const req   = mockReq({ query: { _token: token }, path: '/api/auth/oauth/abandon', headers: {} });
    const res   = mockRes();
    const next  = jest.fn();

    await protect(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(activeUser);
  });

  it('ignores _token query param on non-abandon paths', async () => {
    const token = sign({ id: 'u1' });
    const req   = mockReq({ query: { _token: token }, path: '/api/auth/me', headers: {} });
    const res   = mockRes();
    const next  = jest.fn();

    await protect(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── requireRole ───────────────────────────────────────────────────────────────
describe('requireRole', () => {
  const authedReq = (role) => mockReq({ user: { role } });

  it('calls next() when the user has the exact required role', () => {
    const mw   = requireRole('admin');
    const req  = authedReq('admin');
    const res  = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() when the user has one of multiple allowed roles', () => {
    const mw   = requireRole('landlord', 'property_manager');
    const req  = authedReq('property_manager');
    const res  = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 403 when role is not in the allowed list', () => {
    const mw   = requireRole('admin');
    const req  = authedReq('tenant');
    const res  = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when req.user is not set', () => {
    const mw   = requireRole('admin');
    const req  = mockReq();   // no user
    const res  = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('includes the required role name in the 403 message', () => {
    const mw   = requireRole('law_reviewer');
    const req  = authedReq('tenant');
    const res  = mockRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('law_reviewer') }));
  });
});

// ── Convenience shorthands ────────────────────────────────────────────────────
describe('isLandlord', () => {
  const call = (role) => {
    const req = mockReq({ user: { role } }); const res = mockRes(); const next = jest.fn();
    isLandlord(req, res, next);
    return { res, next };
  };
  it('allows landlord',         () => expect(call('landlord').next).toHaveBeenCalled());
  it('allows property_manager', () => expect(call('property_manager').next).toHaveBeenCalled());
  it('allows admin',            () => expect(call('admin').next).toHaveBeenCalled());
  it('denies tenant',           () => expect(call('tenant').res.status).toHaveBeenCalledWith(403));
});

describe('isAdmin', () => {
  const call = (role) => {
    const req = mockReq({ user: { role } }); const res = mockRes(); const next = jest.fn();
    isAdmin(req, res, next);
    return { res, next };
  };
  it('allows admin',      () => expect(call('admin').next).toHaveBeenCalled());
  it('denies tenant',     () => expect(call('tenant').res.status).toHaveBeenCalledWith(403));
  it('denies landlord',   () => expect(call('landlord').res.status).toHaveBeenCalledWith(403));
});

describe('isTenant', () => {
  const call = (role) => {
    const req = mockReq({ user: { role } }); const res = mockRes(); const next = jest.fn();
    isTenant(req, res, next);
    return { res, next };
  };
  it('allows tenant',   () => expect(call('tenant').next).toHaveBeenCalled());
  it('denies landlord', () => expect(call('landlord').res.status).toHaveBeenCalledWith(403));
  it('denies admin',    () => expect(call('admin').res.status).toHaveBeenCalledWith(403));
});
