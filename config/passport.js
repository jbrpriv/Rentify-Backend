const passport = require('passport');
const GoogleStrategy  = require('passport-google-oauth20').Strategy;

let FacebookStrategy;
try {
  FacebookStrategy = require('passport-facebook').Strategy;
} catch (_) {
  // passport-facebook not installed; Facebook OAuth will be disabled.
}

const User = require('../models/User');

// ─── Shared OAuth upsert helper ───────────────────────────────────────────────
/**
 * Find or create a user from an OAuth profile.
 *
 * EMAIL IS THE PRIMARY KEY — one email = one account, always.
 *
 * Scenarios handled:
 *  1. New user (email not in DB)         → create account, mark provider
 *  2. Existing user, same provider       → update lastLogin, return user
 *  3. Existing user, different provider  → link provider to existing account
 *     e.g. registered via password, now signs in via Google → same account
 *  4. Suspended account                  → reject with clear error
 *
 * The role is NEVER changed by OAuth — if someone registered as a landlord
 * via password and then signs in via Google, they remain a landlord.
 *
 * @param {object} profile  - Passport OAuth profile object
 * @param {string} email    - Verified email from the provider
 * @param {string} provider - 'google' | 'facebook'
 */
async function _oauthUpsert(profile, email, provider) {
  const normalizedEmail = email.toLowerCase().trim();

  // ── Look up by email (the single source of truth) ─────────────────────────
  let user = await User.findOne({ email: normalizedEmail });

  let isNewUser = false;

  if (!user) {
    // ── Case 1: Brand new user ──────────────────────────────────────────────
    isNewUser = true;
    user = await User.create({
      name:          profile.displayName,
      email:         normalizedEmail,
      password:      Math.random().toString(36).slice(-16) + 'Aa1!',
      role:          'tenant',
      phoneNumber:   '0000000000',
      isVerified:    true,
      profilePhoto:  profile.photos?.[0]?.value || null,
      authProviders: [provider],
    });
  } else {
    // ── Suspended account — reject regardless of provider ──────────────────
    if (!user.isActive) {
      throw Object.assign(
        new Error('This account has been suspended. Please contact support.'),
        { code: 'ACCOUNT_SUSPENDED' }
      );
    }

    // ── Case 2 & 3: Existing account — link provider if not already linked ──
    if (!user.authProviders.includes(provider)) {
      user.authProviders.push(provider);
    }

    // Fill in photo if the account has none yet
    if (!user.profilePhoto && profile.photos?.[0]?.value) {
      user.profilePhoto = profile.photos[0].value;
    }

    // OAuth login counts as email verification
    user.isVerified = true;
    user.lastLogin  = new Date();
    await user.save();
  }

  user._isNewUser = isNewUser; // transient flag, not persisted
  return user;
}

// ─── Google Strategy ──────────────────────────────────────────────────────────
passport.use(
  new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  `${process.env.SERVER_URL || 'http://localhost:5000'}/api/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(new Error('No email returned from Google.'), null);

        const user = await _oauthUpsert(profile, email, 'google');
        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// ─── Facebook Strategy ────────────────────────────────────────────────────────
if (FacebookStrategy && process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  passport.use(
    new FacebookStrategy(
      {
        clientID:      process.env.FACEBOOK_APP_ID,
        clientSecret:  process.env.FACEBOOK_APP_SECRET,
        callbackURL:   `${process.env.SERVER_URL || 'http://localhost:5000'}/api/auth/facebook/callback`,
        profileFields: ['id', 'emails', 'name', 'displayName', 'photos'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;

          if (!email) {
            // No email from Facebook (phone-only account or permission not granted).
            // Pass an incomplete marker — authRoutes will redirect to complete-profile
            // where the user supplies their email before an account is created.
            return done(null, {
              incomplete:    true,
              provider:      'facebook',
              facebookId:    profile.id,
              name:          profile.displayName,
              profilePhoto:  profile.photos?.[0]?.value || null,
            });
          }

          const user = await _oauthUpsert(profile, email, 'facebook');
          return done(null, user);
        } catch (err) {
          return done(err, null);
        }
      }
    )
  );
  console.log('✅ Facebook OAuth strategy registered');
} else {
  console.log('ℹ️  Facebook OAuth not configured (credentials missing or passport-facebook not installed)');
}

passport.serializeUser((user, done)   => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password');
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;