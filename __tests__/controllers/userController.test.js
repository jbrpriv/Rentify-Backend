jest.mock('../../models/User');
jest.mock('../../models/Agreement');
jest.mock('../../models/Property');
jest.mock('../../models/Payment');
jest.mock('../../models/MaintenanceRequest');
jest.mock('../../models/Dispute');
jest.mock('../../models/Offer');

const User      = require('../../models/User');
const Agreement = require('../../models/Agreement');
const Property  = require('../../models/Property');

const {
  getUserByEmail,
  getMe,
  getProfile,
  updateProfile,
  updatePreferences,
  getContacts,
  submitVerificationDocuments,
} = require('../../controllers/userController');

// ── Helpers ───────────────────────────────────────────────────────────────────
const mockRes = () => {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json   = jest.fn().mockReturnValue(r);
  return r;
};

const mockReq = (body = {}, user = {}, extras = {}) => ({
  body,
  params: {},
  query:  {},
  user:   { _id: 'user1', role: 'tenant', name: 'Test', email: 'test@x.com', phoneNumber: '0300', ...user },
  ...extras,
});

const buildUserDoc = (o = {}) => ({
  _id: 'user1', name: 'Test User', email: 'test@x.com',
  role: 'tenant', isActive: true, isVerified: true, isPhoneVerified: true,
  phoneNumber: '+923001234567', verificationStatus: 'unverified',
  verificationDocuments: [],
  save: jest.fn().mockResolvedValue(true),
  ...o,
});

// ── getUserByEmail ────────────────────────────────────────────────────────────
describe('getUserByEmail', () => {
  it('returns matching user', async () => {
    const found = { name: 'Bob', email: 'bob@x.com', role: 'tenant' };
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(found) });
    const res = mockRes();
    await getUserByEmail(mockReq({ email: 'bob@x.com' }), res);
    expect(res.json).toHaveBeenCalledWith(found);
  });

  it('returns 404 when user does not exist', async () => {
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await getUserByEmail(mockReq({ email: 'ghost@x.com' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'User not found' });
  });

  it('returns 500 on database error', async () => {
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockRejectedValue(new Error('DB')) });
    const res = mockRes();
    await getUserByEmail(mockReq({ email: 'x@x.com' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── getMe ─────────────────────────────────────────────────────────────────────
describe('getMe', () => {
  it('returns the current user profile', async () => {
    const userDoc = buildUserDoc();
    User.findById = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(userDoc) });
    const res = mockRes();
    await getMe(mockReq(), res);
    expect(User.findById).toHaveBeenCalledWith('user1');
    expect(res.json).toHaveBeenCalledWith(userDoc);
  });

  it('returns 404 when user is not found', async () => {
    User.findById = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await getMe(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'User not found' });
  });

  it('returns 500 on database error', async () => {
    User.findById = jest.fn().mockReturnValue({ select: jest.fn().mockRejectedValue(new Error('DB')) });
    const res = mockRes();
    await getMe(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── getProfile (mirrors getMe) ─────────────────────────────────────────────────
describe('getProfile', () => {
  it('returns the user profile', async () => {
    const userDoc = buildUserDoc();
    User.findById = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(userDoc) });
    const res = mockRes();
    await getProfile(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(userDoc);
  });
});

// ── updateProfile ─────────────────────────────────────────────────────────────
describe('updateProfile', () => {
  it('updates allowed fields and returns the updated user', async () => {
    const updated = buildUserDoc({ name: 'New Name' });
    User.findByIdAndUpdate = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(updated) });
    const res = mockRes();
    await updateProfile(mockReq({ name: 'New Name', profilePhoto: 'https://cdn/photo.jpg' }), res);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'user1',
      expect.objectContaining({ name: 'New Name' }),
      expect.any(Object),
    );
    expect(res.json).toHaveBeenCalledWith(updated);
  });

  it('resets isPhoneVerified when phoneNumber changes', async () => {
    const updated = buildUserDoc({ isPhoneVerified: false });
    User.findByIdAndUpdate = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(updated) });
    const res = mockRes();
    // user.phoneNumber is different from new phoneNumber
    await updateProfile(
      mockReq({ phoneNumber: '+923009999999' }, { phoneNumber: '+923001234567' }),
      res,
    );
    const [, updates] = User.findByIdAndUpdate.mock.calls[0];
    expect(updates.isPhoneVerified).toBe(false);
  });

  it('does NOT reset isPhoneVerified when phoneNumber is unchanged', async () => {
    const updated = buildUserDoc();
    User.findByIdAndUpdate = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(updated) });
    const res = mockRes();
    // Same phone number
    await updateProfile(
      mockReq({ phoneNumber: '+923001234567' }, { phoneNumber: '+923001234567' }),
      res,
    );
    const [, updates] = User.findByIdAndUpdate.mock.calls[0];
    expect(updates).not.toHaveProperty('isPhoneVerified');
  });

  it('strips fields not in the allowlist', async () => {
    const updated = buildUserDoc();
    User.findByIdAndUpdate = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(updated) });
    const res = mockRes();
    await updateProfile(mockReq({ isAdmin: true, __secret: 'hack' }), res);
    const [, updates] = User.findByIdAndUpdate.mock.calls[0];
    expect(updates).not.toHaveProperty('isAdmin');
    expect(updates).not.toHaveProperty('__secret');
  });

  it('rejects disallowed role values like "admin"', async () => {
    const updated = buildUserDoc();
    User.findByIdAndUpdate = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(updated) });
    const res = mockRes();
    await updateProfile(mockReq({ role: 'admin' }), res);
    const [, updates] = User.findByIdAndUpdate.mock.calls[0];
    expect(updates).not.toHaveProperty('role');
  });

  it('allows valid role values: landlord, tenant, property_manager', async () => {
    const updated = buildUserDoc({ role: 'landlord' });
    User.findByIdAndUpdate = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(updated) });
    const res = mockRes();
    await updateProfile(mockReq({ role: 'landlord' }), res);
    const [, updates] = User.findByIdAndUpdate.mock.calls[0];
    expect(updates.role).toBe('landlord');
  });

  it('returns 500 on database error', async () => {
    User.findByIdAndUpdate = jest.fn().mockReturnValue({ select: jest.fn().mockRejectedValue(new Error('DB')) });
    const res = mockRes();
    await updateProfile(mockReq({ name: 'Fail' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── updatePreferences ─────────────────────────────────────────────────────────
describe('updatePreferences', () => {
  it('updates smsOptIn and emailOptIn when both are provided', async () => {
    const updated = { smsOptIn: true, emailOptIn: false };
    User.findByIdAndUpdate = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(updated) });
    const res = mockRes();
    await updatePreferences(mockReq({ smsOptIn: true, emailOptIn: false }), res);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'user1', { smsOptIn: true, emailOptIn: false }, { returnDocument: 'after' },
    );
    expect(res.json).toHaveBeenCalledWith(updated);
  });

  it('only includes fields that are present in the request body', async () => {
    const updated = { smsOptIn: false };
    User.findByIdAndUpdate = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(updated) });
    const res = mockRes();
    await updatePreferences(mockReq({ smsOptIn: false }), res);
    const [, updates] = User.findByIdAndUpdate.mock.calls[0];
    expect(updates).toHaveProperty('smsOptIn', false);
    expect(updates).not.toHaveProperty('emailOptIn');
  });

  it('returns 500 on database error', async () => {
    User.findByIdAndUpdate = jest.fn().mockReturnValue({ select: jest.fn().mockRejectedValue(new Error('DB')) });
    const res = mockRes();
    await updatePreferences(mockReq({ smsOptIn: true }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── getContacts ───────────────────────────────────────────────────────────────
describe('getContacts', () => {
  describe('admin / law_reviewer', () => {
    it('queries only authority-level users (admin, law_reviewer)', async () => {
      const users = [{ _id: 'a2', name: 'Admin2', email: 'a@b.com', role: 'admin', profilePhoto: null }];
      User.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        limit:  jest.fn().mockResolvedValue(users),
      });
      const res = mockRes();
      await getContacts(mockReq({}, { _id: 'admin1', role: 'admin' }), res);
      expect(User.find).toHaveBeenCalledWith(expect.objectContaining({
        role: { $in: ['admin', 'law_reviewer'] },
      }));
      expect(res.json).toHaveBeenCalled();
    });

    it('returns 500 on database error', async () => {
      User.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        limit:  jest.fn().mockRejectedValue(new Error('DB error')),
      });
      const res = mockRes();
      await getContacts(mockReq({}, { _id: 'admin1', role: 'admin' }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('landlord', () => {
    it('queries agreements and properties', async () => {
      const populateFn = jest.fn().mockReturnThis();
      Agreement.find = jest.fn().mockReturnValue({ populate: populateFn });
      populateFn.mockResolvedValue([]);
      Property.find = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue([]) });

      const res = mockRes();
      await getContacts(mockReq({}, { _id: 'landlord1', role: 'landlord' }), res);
      expect(Agreement.find).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });
  });
});

// ── submitVerificationDocuments ───────────────────────────────────────────────
describe('submitVerificationDocuments', () => {
  const validDoc = [{ url: 'https://cdn/doc.pdf', documentType: 'cnic', originalName: 'cnic.pdf' }];

  it('saves documents and sets verificationStatus to pending', async () => {
    const user = buildUserDoc({ role: 'landlord', verificationStatus: 'unverified' });
    User.findById = jest.fn().mockResolvedValue(user);
    const res = mockRes();
    await submitVerificationDocuments(mockReq({ documents: validDoc }), res);
    expect(user.verificationStatus).toBe('pending');
    expect(user.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/submitted/i) }));
  });

  it('works for property_manager role too', async () => {
    const user = buildUserDoc({ role: 'property_manager', verificationStatus: 'unverified' });
    User.findById = jest.fn().mockResolvedValue(user);
    const res = mockRes();
    await submitVerificationDocuments(mockReq({ documents: validDoc }), res);
    expect(user.verificationStatus).toBe('pending');
  });

  it('returns 403 when a tenant tries to submit documents', async () => {
    User.findById = jest.fn().mockResolvedValue(buildUserDoc({ role: 'tenant' }));
    const res = mockRes();
    await submitVerificationDocuments(mockReq({ documents: validDoc }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 when documents array is empty', async () => {
    User.findById = jest.fn().mockResolvedValue(buildUserDoc({ role: 'landlord' }));
    const res = mockRes();
    await submitVerificationDocuments(mockReq({ documents: [] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/At least one/i) }));
  });

  it('returns 400 when documents is not an array', async () => {
    User.findById = jest.fn().mockResolvedValue(buildUserDoc({ role: 'landlord' }));
    const res = mockRes();
    await submitVerificationDocuments(mockReq({ documents: null }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when account is already approved', async () => {
    User.findById = jest.fn().mockResolvedValue(buildUserDoc({ role: 'landlord', verificationStatus: 'approved' }));
    const res = mockRes();
    await submitVerificationDocuments(mockReq({ documents: validDoc }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when user is not found', async () => {
    User.findById = jest.fn().mockResolvedValue(null);
    const res = mockRes();
    await submitVerificationDocuments(mockReq({ documents: validDoc }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
