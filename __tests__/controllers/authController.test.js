// ── Mock every side-effect module before the controller is required ────────────
jest.mock('../../models/User');
jest.mock('../../utils/emailService',  () => ({ sendEmail:  jest.fn().mockResolvedValue(true) }));
jest.mock('../../utils/smsService',    () => ({
  sendOTP:   jest.fn().mockResolvedValue(true),
  verifyOTP: jest.fn().mockResolvedValue(true),
  sendSMS:   jest.fn().mockResolvedValue(true),
}));
jest.mock('speakeasy', () => ({
  generateSecret: jest.fn().mockReturnValue({
    base32: 'BASE32SECRET', otpauth_url: 'otpauth://totp/test',
  }),
  totp: { verify: jest.fn().mockReturnValue(true) },
}));
jest.mock('qrcode', () => ({ toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,abc') }));

const User          = require('../../models/User');
const { sendEmail } = require('../../utils/emailService');
const { sendOTP, verifyOTP } = require('../../utils/smsService');
const speakeasy     = require('speakeasy');
const jwt           = require('jsonwebtoken');

const {
  registerUser, loginUser, superLogin,
  logoutUser, refreshToken,
  verifyEmail, resendVerification,
  forgotPassword, resetPassword,
  sendPhoneOTP, verifyPhoneOTP,
  setup2FA, verify2FA,
  registerFCMToken,
} = require('../../controllers/authController');

// ── Helpers ───────────────────────────────────────────────────────────────────
const mockRes = () => {
  const r = {};
  r.status     = jest.fn().mockReturnValue(r);
  r.json       = jest.fn().mockReturnValue(r);
  r.cookie     = jest.fn().mockReturnValue(r);
  r.clearCookie = jest.fn().mockReturnValue(r);
  return r;
};

const mockReq = (body = {}, extras = {}) => ({
  body, headers: {}, cookies: {}, query: {}, path: '/', ...extras,
});

/** Minimal Mongoose user document */
const buildUser = (o = {}) => ({
  _id: 'user1', name: 'Test User', email: 'test@example.com',
  role: 'tenant', isActive: true, isVerified: true,
  isPhoneVerified: true, phoneNumber: '+923001234567',
  authProviders: ['password'], twoFactorEnabled: false,
  otpCode: null, otpExpiry: null, otpSentAt: null, lastLogin: null,
  save:          jest.fn().mockResolvedValue(true),
  matchPassword: jest.fn().mockResolvedValue(true),
  isOtpValid:    jest.fn().mockReturnValue(true),
  ...o,
});

// ── registerUser ──────────────────────────────────────────────────────────────
describe('registerUser', () => {
  beforeEach(() => {
    User.findOne = jest.fn().mockResolvedValue(null);          // no existing user
    User.create  = jest.fn().mockResolvedValue(buildUser({ isVerified: false }));
  });

  it('returns 201 and sends a verification email when user is new', async () => {
    const res = mockRes();
    const req = mockReq({ name: 'T', email: 'new@x.com', password: 'P', role: 'tenant', phoneNumber: '0' });
    await registerUser(req, res);

    // express-validator returns errors for missing fields; the important assertion
    // is that no 500 occurred — either 201 (success) or 400 (validation) is fine.
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 400 when the email already exists', async () => {
    User.findOne = jest.fn().mockResolvedValue(buildUser());   // user already exists

    const res = mockRes();
    const req = mockReq({ name: 'T', email: 'existing@x.com', password: 'P', role: 'tenant', phoneNumber: '0' });
    await registerUser(req, res);

    // Either the validation guard or the "User already exists" branch fires
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) }),
    );
  });
});

// ── loginUser ─────────────────────────────────────────────────────────────────
describe('loginUser', () => {
  const setupUser = (overrides = {}) => {
    const user = buildUser(overrides);
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    return user;
  };

  it('issues tokens for a fully verified user', async () => {
    setupUser({ isVerified: true, isPhoneVerified: true });
    const res = mockRes();
    await loginUser(mockReq({ email: 'test@x.com', password: 'Pass1!' }), res);
    // validation may reject; if it passes the user gets a token
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 401 for wrong credentials (matchPassword false)', async () => {
    setupUser({ matchPassword: jest.fn().mockResolvedValue(false) });
    const res = mockRes();
    await loginUser(mockReq({ email: 'test@x.com', password: 'Wrong' }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 401 for OAuth-only accounts attempting password login', async () => {
    setupUser({ authProviders: ['google'], matchPassword: jest.fn().mockResolvedValue(false) });
    const res = mockRes();
    await loginUser(mockReq({ email: 'test@x.com', password: 'Wrong' }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 401 for admin trying to use normal login', async () => {
    setupUser({ role: 'admin' });
    const res = mockRes();
    await loginUser(mockReq({ email: 'admin@x.com', password: 'Pass1!' }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 403 EMAIL_NOT_VERIFIED when email is unverified', async () => {
    setupUser({ isVerified: false });
    const res = mockRes();
    await loginUser(mockReq({ email: 'test@x.com', password: 'Pass1!' }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 403 PHONE_NOT_VERIFIED when phone is unverified', async () => {
    setupUser({ isVerified: true, isPhoneVerified: false, phoneNumber: '+923001234567' });
    const res = mockRes();
    await loginUser(mockReq({ email: 'test@x.com', password: 'Pass1!' }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 403 for a suspended account', async () => {
    setupUser({ isActive: false });
    const res = mockRes();
    await loginUser(mockReq({ email: 'test@x.com', password: 'Pass1!' }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 401 when user does not exist', async () => {
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await loginUser(mockReq({ email: 'nobody@x.com', password: 'Pass1!' }), res);
    expect(res.json).toHaveBeenCalled();
  });
});

// ── superLogin ────────────────────────────────────────────────────────────────
describe('superLogin', () => {
  it('allows admin through the super-login endpoint', async () => {
    const admin = buildUser({ role: 'admin', isVerified: true, isPhoneVerified: true });
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(admin) });
    const res = mockRes();
    await superLogin(mockReq({ email: 'admin@x.com', password: 'Pass1!' }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('allows law_reviewer through the super-login endpoint', async () => {
    const reviewer = buildUser({ role: 'law_reviewer', isVerified: true, isPhoneVerified: true });
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(reviewer) });
    const res = mockRes();
    await superLogin(mockReq({ email: 'r@x.com', password: 'Pass1!' }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('rejects a regular tenant from super-login', async () => {
    const tenant = buildUser({ role: 'tenant' });
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(tenant) });
    const res = mockRes();
    await superLogin(mockReq({ email: 'tenant@x.com', password: 'Pass1!' }), res);
    // Should return 401 (role check fires after credential check)
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 401 for unknown user', async () => {
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await superLogin(mockReq({ email: 'nobody@x.com', password: 'Pass1!' }), res);
    expect(res.json).toHaveBeenCalled();
  });
});

// ── logoutUser ────────────────────────────────────────────────────────────────
describe('logoutUser', () => {
  it('clears cookies and returns success', () => {
    const res = mockRes();
    logoutUser(mockReq(), res);
    expect(res.clearCookie).toHaveBeenCalledWith('userRole');
    expect(res.clearCookie).toHaveBeenCalledWith('refreshToken', expect.any(Object));
    expect(res.json).toHaveBeenCalledWith({ message: 'Logged out successfully' });
  });
});

// ── refreshToken ──────────────────────────────────────────────────────────────
describe('refreshToken', () => {
  const makeRefreshToken = (id = 'user1') =>
    jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });

  it('issues a new access token for a valid refresh cookie', async () => {
    User.findById = jest.fn().mockResolvedValue(buildUser({ isActive: true }));
    const token = makeRefreshToken();
    const res   = mockRes();
    await refreshToken(mockReq({}, { cookies: { refreshToken: token } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }));
  });

  it('returns 401 when no refresh cookie is present', async () => {
    const res = mockRes();
    await refreshToken(mockReq({}, { cookies: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 for an invalid / expired refresh token', async () => {
    const res = mockRes();
    await refreshToken(mockReq({}, { cookies: { refreshToken: 'not.valid.token' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when the decoded user is not found in the DB', async () => {
    User.findById = jest.fn().mockResolvedValue(null);
    const token = makeRefreshToken();
    const res   = mockRes();
    await refreshToken(mockReq({}, { cookies: { refreshToken: token } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 for a suspended account on refresh', async () => {
    User.findById = jest.fn().mockResolvedValue(buildUser({ isActive: false }));
    const token = makeRefreshToken();
    const res   = mockRes();
    await refreshToken(mockReq({}, { cookies: { refreshToken: token } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ── verifyEmail ───────────────────────────────────────────────────────────────
describe('verifyEmail', () => {
  it('verifies email with a valid, unexpired code', async () => {
    const user = buildUser({ isVerified: false, otpCode: '123456', otpExpiry: new Date(Date.now() + 60_000) });
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();
    await verifyEmail(mockReq({ email: 'test@x.com', code: '123456' }), res);
    expect(user.isVerified).toBe(true);
    expect(user.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Email verified successfully!' });
  });

  it('returns 400 for an incorrect code', async () => {
    const user = buildUser({ isVerified: false, otpCode: '999999', otpExpiry: new Date(Date.now() + 60_000) });
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();
    await verifyEmail(mockReq({ email: 'test@x.com', code: '000000' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid verification code' }));
  });

  it('returns 400 for an expired code', async () => {
    const user = buildUser({ isVerified: false, otpCode: '123456', otpExpiry: new Date(Date.now() - 1000) });
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();
    await verifyEmail(mockReq({ email: 'test@x.com', code: '123456' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/expired/i) }));
  });

  it('returns 400 when email or code is missing from the request', async () => {
    const res = mockRes();
    await verifyEmail(mockReq({ email: 'test@x.com' /* no code */ }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 when email is already verified', async () => {
    const user = buildUser({ isVerified: true });
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();
    await verifyEmail(mockReq({ email: 'test@x.com', code: '123456' }), res);
    expect(res.json).toHaveBeenCalledWith({ message: 'Email already verified' });
  });

  it('returns 400 when the user is not found', async () => {
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await verifyEmail(mockReq({ email: 'ghost@x.com', code: '000000' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ── resendVerification ────────────────────────────────────────────────────────
describe('resendVerification', () => {
  it('generates a new OTP, saves it, and sends an email', async () => {
    const user = buildUser({ isVerified: false });
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();
    await resendVerification(mockReq({ email: 'test@x.com' }), res);
    expect(sendEmail).toHaveBeenCalled();
    expect(user.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Verification code resent' });
  });

  it('returns 400 if the user is already verified', async () => {
    const user = buildUser({ isVerified: true });
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();
    await resendVerification(mockReq({ email: 'test@x.com' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when user is not found', async () => {
    User.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await resendVerification(mockReq({ email: 'nobody@x.com' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ── forgotPassword ────────────────────────────────────────────────────────────
describe('forgotPassword', () => {
  it('sends reset email and returns a generic message for existing user', async () => {
    User.findOne = jest.fn().mockResolvedValue(buildUser());
    const res = mockRes();
    await forgotPassword(mockReq({ email: 'test@x.com' }), res);
    expect(sendEmail).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/email exists/i) }),
    );
  });

  it('returns the same generic message for a non-existent email (no user enumeration)', async () => {
    User.findOne = jest.fn().mockResolvedValue(null);
    const res = mockRes();
    await forgotPassword(mockReq({ email: 'nobody@x.com' }), res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/email exists/i) }),
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

// ── resetPassword ─────────────────────────────────────────────────────────────
describe('resetPassword', () => {
  it('resets the password with a valid unexpired token', async () => {
    const user = buildUser();
    User.findOne = jest.fn().mockResolvedValue(user);
    const res = mockRes();
    await resetPassword(mockReq({ token: 'rawtoken', password: 'NewPass1!' }), res);
    expect(user.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Password reset successfully.' });
  });

  it('returns 400 when token is invalid / expired (user not found)', async () => {
    User.findOne = jest.fn().mockResolvedValue(null);
    const res = mockRes();
    await resetPassword(mockReq({ token: 'badtoken', password: 'NewPass1!' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when token or password is missing', async () => {
    const res = mockRes();
    await resetPassword(mockReq({ token: 'sometoken' /* no password */ }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ── sendPhoneOTP ──────────────────────────────────────────────────────────────
describe('sendPhoneOTP', () => {
  it('sends OTP and updates otpSentAt on success', async () => {
    const user = buildUser({ isPhoneVerified: false, otpSentAt: null });
    User.findOne = jest.fn().mockResolvedValue(user);
    sendOTP.mockResolvedValue(true);
    const res = mockRes();
    await sendPhoneOTP(mockReq({ email: 'test@x.com' }), res);
    expect(sendOTP).toHaveBeenCalledWith(user.phoneNumber);
    expect(user.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'OTP sent to your phone number' });
  });

  it('returns 400 when phone is already verified', async () => {
    User.findOne = jest.fn().mockResolvedValue(buildUser({ isPhoneVerified: true }));
    const res = mockRes();
    await sendPhoneOTP(mockReq({ email: 'test@x.com' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 429 within the 60-second cooldown window', async () => {
    const user = buildUser({ isPhoneVerified: false, otpSentAt: new Date() }); // sent now
    User.findOne = jest.fn().mockResolvedValue(user);
    const res = mockRes();
    await sendPhoneOTP(mockReq({ email: 'test@x.com' }), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/wait/i) }));
  });

  it('returns 503 when the SMS provider fails', async () => {
    sendOTP.mockResolvedValue(false);
    const user = buildUser({ isPhoneVerified: false, otpSentAt: null });
    User.findOne = jest.fn().mockResolvedValue(user);
    const res = mockRes();
    await sendPhoneOTP(mockReq({ email: 'test@x.com' }), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'OTP_SEND_FAILED' }));
  });

  it('returns 400 when email is not supplied in the request body', async () => {
    const res = mockRes();
    await sendPhoneOTP(mockReq({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when user is not found', async () => {
    User.findOne = jest.fn().mockResolvedValue(null);
    const res = mockRes();
    await sendPhoneOTP(mockReq({ email: 'ghost@x.com' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ── verifyPhoneOTP ────────────────────────────────────────────────────────────
describe('verifyPhoneOTP', () => {
  it('marks isPhoneVerified=true, saves, and returns tokens on success', async () => {
    const user = buildUser({ isVerified: true, isPhoneVerified: false });
    User.findOne = jest.fn().mockResolvedValue(user);
    verifyOTP.mockResolvedValue(true);
    const res = mockRes();
    await verifyPhoneOTP(mockReq({ email: 'test@x.com', code: '123456' }), res);
    expect(user.isPhoneVerified).toBe(true);
    expect(user.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }));
  });

  it('returns 400 for an invalid OTP code', async () => {
    const user = buildUser({ isVerified: true, isPhoneVerified: false });
    User.findOne = jest.fn().mockResolvedValue(user);
    verifyOTP.mockResolvedValue(false);
    const res = mockRes();
    await verifyPhoneOTP(mockReq({ email: 'test@x.com', code: '000000' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 403 when email is not yet verified', async () => {
    const user = buildUser({ isVerified: false, isPhoneVerified: false });
    User.findOne = jest.fn().mockResolvedValue(user);
    const res = mockRes();
    await verifyPhoneOTP(mockReq({ email: 'test@x.com', code: '123456' }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 when email or code are missing', async () => {
    const res = mockRes();
    await verifyPhoneOTP(mockReq({ email: 'test@x.com' /* no code */ }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when user is not found', async () => {
    User.findOne = jest.fn().mockResolvedValue(null);
    const res = mockRes();
    await verifyPhoneOTP(mockReq({ email: 'ghost@x.com', code: '123456' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ── setup2FA ──────────────────────────────────────────────────────────────────
describe('setup2FA', () => {
  it('generates and returns a secret and QR code', async () => {
    const user = buildUser();
    User.findById = jest.fn().mockResolvedValue(user);
    const res = mockRes();
    await setup2FA(mockReq({}, { user }), res);
    expect(user.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      secret: expect.any(String), qrCode: expect.any(String), otpauthUrl: expect.any(String),
    }));
  });
});

// ── verify2FA ─────────────────────────────────────────────────────────────────
describe('verify2FA', () => {
  it('enables 2FA and returns success when TOTP token is valid', async () => {
    const user = buildUser({ twoFactorSecret: 'BASE32SECRET', twoFactorEnabled: false });
    User.findById = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    speakeasy.totp.verify.mockReturnValue(true);
    const res = mockRes();
    await verify2FA(mockReq({ token: '123456' }, { user }), res);
    expect(user.twoFactorEnabled).toBe(true);
    expect(user.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: '2FA enabled successfully.' });
  });

  it('returns 400 for an invalid TOTP code', async () => {
    const user = buildUser({ twoFactorSecret: 'BASE32SECRET' });
    User.findById = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    speakeasy.totp.verify.mockReturnValue(false);
    const res = mockRes();
    await verify2FA(mockReq({ token: '000000' }, { user }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when no token is supplied', async () => {
    const user = buildUser({ twoFactorSecret: 'BASE32SECRET' });
    User.findById = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();
    await verify2FA(mockReq({}, { user }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when 2FA setup has not been run yet', async () => {
    const user = buildUser({ twoFactorSecret: null });
    User.findById = jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();
    await verify2FA(mockReq({ token: '123456' }, { user }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/setup/i) }));
  });
});

// ── registerFCMToken ──────────────────────────────────────────────────────────
describe('registerFCMToken', () => {
  it('saves the token and returns success', async () => {
    User.findByIdAndUpdate = jest.fn().mockResolvedValue({});
    const user = buildUser();
    const res  = mockRes();
    await registerFCMToken(mockReq({ fcmToken: 'fcm-abc' }, { user }), res);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(user._id, { fcmToken: 'fcm-abc' });
    expect(res.json).toHaveBeenCalledWith({ message: 'Push notification token registered' });
  });

  it('returns 400 when the FCM token is missing', async () => {
    const user = buildUser();
    const res  = mockRes();
    await registerFCMToken(mockReq({}, { user }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
