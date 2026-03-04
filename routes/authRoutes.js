const express  = require('express');
const router   = express.Router();
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
  registerFCMToken,
} = require('../controllers/authController');

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
  verifyRecaptcha,
  loginUser
);

router.post('/refresh', refreshToken);
router.post('/logout', protect, logoutUser);

router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

router.post('/send-otp', protect, sendPhoneOTP);
router.post('/verify-otp', protect, verifyPhoneOTP);

router.post('/2fa/setup', protect, setup2FA);
router.post('/2fa/verify', protect, verify2FA);
router.post('/2fa/disable/send-otp', protect, send2FADisableOTP);
router.post('/2fa/disable', protect, disable2FA);
router.post('/2fa/validate', validate2FALogin);

router.post('/fcm-token', protect, registerFCMToken);

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
        // ── Facebook with no email: collect email via complete-profile first ──
        // No account is created until the user provides a real email, which is
        // then checked against existing accounts before creation.
        if (user.incomplete) {
          const params = new URLSearchParams({
            provider:     providerName,
            facebookId:   user.facebookId   || '',
            name:         user.name         || '',
            profilePhoto: user.profilePhoto || '',
            needsEmail:   'true',
          });
          return res.redirect(
            `${process.env.CLIENT_URL}/auth/oauth/complete-profile?${params.toString()}`
          );
        }

        // ── Fully resolved user — issue tokens ────────────────────────────────
        const accessToken       = generateAccessToken(user._id);
        const refreshTokenValue = generateRefreshToken(user._id);

        res.cookie('refreshToken', refreshTokenValue, {
          httpOnly: true,
          secure:   process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
        });

        const params = new URLSearchParams({
          token:           accessToken,
          name:            user.name,
          role:            user.role,
          id:              user._id.toString(),
          email:           user.email,
          isPhoneVerified: String(user.isPhoneVerified),
          isNewUser:       String(!!user._isNewUser),
          provider:        providerName,
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