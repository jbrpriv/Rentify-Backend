const express = require('express');
const router = express.Router();
const passport = require('../config/passport');
const { body } = require('express-validator');
const { protect } = require('../middlewares/authMiddleware');
const { verifyRecaptcha } = require('../middlewares/recaptchaMiddleware');
const { generateAccessToken, generateRefreshToken } = require('../utils/generateToken');
const {
  registerUser, loginUser, refreshToken, logoutUser,
  verifyEmail, resendVerification,
  forgotPassword, resetPassword,
  sendPhoneOTP, verifyPhoneOTP,
  setup2FA, verify2FA, disable2FA, send2FADisableOTP, validate2FALogin,
  registerFCMToken, facebookComplete,
  abandonOAuthAccount,
} = require('../controllers/authController');
const User = require('../models/User');

// Runs BEFORE reCAPTCHA on the login route.
// If the email belongs to an OAuth-only account (no password provider) we
// return OAUTH_ACCOUNT immediately — no point burning a reCAPTCHA token or
// letting it time out while the user waits.
const checkOAuthBeforeRecaptcha = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return next();
    const user = await User.findOne({ email }).select('authProviders');
    if (
      user &&
      Array.isArray(user.authProviders) &&
      !user.authProviders.includes('password')
    ) {
      const provider = user.authProviders.find(p => p !== 'password') || 'social';
      return res.status(401).json({ message: 'OAUTH_ACCOUNT', provider });
    }
    next();
  } catch {
    next(); // any DB error — let loginUser handle it normally
  }
};

// ─── Register ─────────────────────────────────────────────────────────────────
router.post('/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Please enter a valid email address'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('phoneNumber').trim().notEmpty().withMessage('Phone number is required'),
  ],
  verifyRecaptcha,
  registerUser
);

// ─── Login ────────────────────────────────────────────────────────────────────
router.post('/login',
  [
    body('email').isEmail().withMessage('Please enter a valid email address'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  checkOAuthBeforeRecaptcha, // must run before verifyRecaptcha so OAuth users get a clear message
  verifyRecaptcha,
  loginUser
);

router.post('/refresh', refreshToken);
router.post('/logout', protect, logoutUser);

router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// These two routes are intentionally public — the user has no token yet.
// Identity is established by email in the request body.
// The real JWT is only issued by verify-otp on success.
router.post('/send-otp', sendPhoneOTP);
router.post('/verify-otp', verifyPhoneOTP);

router.post('/2fa/setup', protect, setup2FA);
router.post('/2fa/verify', protect, verify2FA);
router.post('/2fa/disable/send-otp', protect, send2FADisableOTP);
router.post('/2fa/disable', protect, disable2FA);
router.post('/2fa/validate', validate2FALogin);

router.post('/fcm-token', protect, registerFCMToken);
router.post('/facebook/complete', facebookComplete); // no auth — creates the account
router.post('/oauth/abandon', protect, abandonOAuthAccount);  // wipe incomplete OAuth account (POST so sendBeacon works)

// ─── Generic OAuth callback handler ──────────────────────────────────────────
/**
 * Factory that returns an Express route handler for any OAuth provider.
 *
 * Email is the primary key — if an account with the same email already
 * exists (regardless of how it was created: password, Google, Facebook,
 * or any other role), the providers are linked and the same account is
 * returned. No duplicate accounts are ever created.
 *
 * Error codes forwarded to the frontend via query params:
 *   oauth_error       — provider-level error (bad token, network, etc.)
 *   oauth_failed      — strategy returned no user (shouldn't happen normally)
 *   account_suspended — the matching email account has been banned
 */
function makeOAuthCallback(providerName) {
  return (req, res, next) => {
    passport.authenticate(providerName, { session: false }, async (err, user) => {

      // ── Suspended account ─────────────────────────────────────────────────
      if (err?.code === 'ACCOUNT_SUSPENDED') {
        return res.redirect(
          `${process.env.CLIENT_URL}/login?error=account_suspended&provider=${providerName}`
        );
      }

      // ── Any other passport/strategy error ─────────────────────────────────
      if (err) {
        console.error(`${providerName} OAuth error:`, err.message);
        return res.redirect(
          `${process.env.CLIENT_URL}/login?error=oauth_error&provider=${providerName}`
        );
      }

      // ── Strategy returned null (should not happen with current passport.js) ─
      if (!user) {
        return res.redirect(
          `${process.env.CLIENT_URL}/login?error=oauth_failed&provider=${providerName}`
        );
      }

      try {
        // ── Facebook with no email: redirect to /register with a notice ─────
        // Allowing the user to type an arbitrary email here risks silently
        // linking their Facebook to an *existing* account (wrong portal bug).
        // The safest UX is to send them to manual sign-up with an explanation.
        if (user.incomplete) {
          const params = new URLSearchParams({ notice: 'facebook_no_email' });
          return res.redirect(
            `${process.env.CLIENT_URL}/register?${params.toString()}`
          );
        }

        // ── Fully resolved user — issue tokens ────────────────────────────────
        const accessToken = generateAccessToken(user._id);
        const refreshTokenValue = generateRefreshToken(user._id);

        res.cookie('refreshToken', refreshTokenValue, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });

        // A user needs the onboarding flow if:
        //   (a) They have never set a phone number (brand-new Google account), OR
        //   (b) They set a phone number but closed the tab before verifying the OTP
        //       (profileComplete but isPhoneVerified is still false).
        // In case (b) we pass skipToOTP=true so the complete-profile page jumps
        // directly to the OTP step without asking them to re-enter their details.
        const hasPlaceholderPhone = user.phoneNumber === '0000000000';
        const isNewUser = hasPlaceholderPhone || !user.isPhoneVerified;

        const params = new URLSearchParams({
          token: accessToken,
          name: user.name,
          role: user.role,
          id: user._id.toString(),
          email: user.email,
          isPhoneVerified: String(user.isPhoneVerified),
          isNewUser: String(isNewUser),
          provider: providerName,
          // Pass existing phone so complete-profile can pre-populate the field.
          // skipToOTP signals the profile form should lock name/role but keep
          // phone editable — the user may want to correct their number.
          phoneNumber: hasPlaceholderPhone ? '' : user.phoneNumber,
          skipToOTP: String(!hasPlaceholderPhone && !user.isPhoneVerified),
        });

        return res.redirect(
          `${process.env.CLIENT_URL}/auth/oauth/success?${params.toString()}`
        );
      } catch (callbackErr) {
        return next(callbackErr);
      }
    })(req, res, next);
  };
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get('/google/callback', makeOAuthCallback('google'));

// ─── Facebook OAuth ───────────────────────────────────────────────────────────
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  router.get('/facebook',
    passport.authenticate('facebook', { scope: ['email', 'public_profile'] })
  );
  router.get('/facebook/callback', makeOAuthCallback('facebook'));
}

module.exports = router;
/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication and account management
 *
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, role]
 *             properties:
 *               name: { type: string, example: "Ali Hassan" }
 *               email: { type: string, example: "ali@example.com" }
 *               password: { type: string, example: "Password123!" }
 *               role: { type: string, enum: [landlord, tenant] }
 *               phoneNumber: { type: string, example: "03001234567" }
 *     responses:
 *       201: { description: User registered, email verification OTP sent }
 *       400: { description: Validation error or email already in use }
 *
 * /api/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: Login successful, returns access token }
 *       401: { description: Invalid credentials }
 *       403: { description: Account suspended }
 *
 * /api/auth/logout:
 *   post:
 *     summary: Logout and clear refresh token cookie
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Logged out }
 *
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token using httpOnly refresh cookie
 *     tags: [Auth]
 *     responses:
 *       200: { description: New access token returned }
 *       401: { description: Refresh token invalid or expired }
 *
 * /api/auth/verify-email:
 *   post:
 *     summary: Verify email with OTP code
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *               code: { type: string, example: "123456" }
 *     responses:
 *       200: { description: Email verified }
 *       400: { description: Invalid or expired OTP }
 *
 * /api/auth/forgot-password:
 *   post:
 *     summary: Send password reset link
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *     responses:
 *       200: { description: Reset link sent if email exists }
 *
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password using token from email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: Password reset successful }
 *       400: { description: Invalid or expired token }
 */