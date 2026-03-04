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
 * On success it redirects to the shared frontend page:
 *   /auth/oauth/success?token=...&name=...&role=...&id=...&email=...
 *                      &isPhoneVerified=...&profileComplete=...&provider=...
 *
 * The frontend then decides whether to send the user to /dashboard or to
 * /auth/oauth/complete-profile based on the `profileComplete` flag.
 *
 * @param {string} providerName - 'google' | 'facebook' (used for error messages & the `provider` param)
 */
function makeOAuthCallback(providerName) {
  return (req, res, next) => {
    passport.authenticate(providerName, { session: false }, async (err, user) => {

      // Auth-level error (bad credentials, revoked token, network issue, etc.)
      if (err) {
        console.error(`${providerName} OAuth error:`, err.message);
        return res.redirect(
          `${process.env.CLIENT_URL}/login?error=oauth_error&provider=${providerName}`
        );
      }

      // Strategy returned false/null (e.g. Facebook account has no email)
      if (!user) {
        return res.redirect(
          `${process.env.CLIENT_URL}/login?error=oauth_failed&provider=${providerName}`
        );
      }

      try {
        const accessToken        = generateAccessToken(user._id);
        const refreshTokenValue  = generateRefreshToken(user._id);

        // HttpOnly refresh cookie — identical settings for every provider
        res.cookie('refreshToken', refreshTokenValue, {
          httpOnly: true,
          secure:   process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
        });

        // Profile is "complete" once the user has a real phone that is verified.
        // New OAuth users get the '0000000000' placeholder until they finish setup.
        const profileComplete =
          user.isPhoneVerified && user.phoneNumber !== '0000000000';

        // Both providers land on the SAME generic success page so frontend
        // logic never needs to diverge per-provider.
        const params = new URLSearchParams({
          token:           accessToken,
          name:            user.name,
          role:            user.role,
          id:              user._id.toString(),
          email:           user.email,
          isPhoneVerified: String(user.isPhoneVerified),
          profileComplete: String(profileComplete),
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
// Routes are only registered when credentials are present in the environment.
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  router.get('/facebook',
    passport.authenticate('facebook', { scope: ['email', 'public_profile'] })
  );

  router.get('/facebook/callback', makeOAuthCallback('facebook'));
}

module.exports = router;