const passport    = require('passport');
const GoogleStrategy   = require('passport-google-oauth20').Strategy;
// passport-facebook is an optional dependency — only loaded when credentials are configured.
let FacebookStrategy;
try {
  FacebookStrategy = require('passport-facebook').Strategy;
} catch (_) {
  // passport-facebook not installed; Facebook OAuth will be disabled.
}

const User        = require('../models/User');
const { generateAccessToken, generateRefreshToken } = require('../utils/generateToken');

// ─── Shared OAuth upsert helper ───────────────────────────────────────────────
/**
 * Find or create a user from an OAuth profile.
 * Works for both Google and Facebook strategies.
 */
async function _oauthUpsert(profile, email) {
  let user = await User.findOne({ email });

  if (!user) {
    user = await User.create({
      name:         profile.displayName,
      email,
      password:     Math.random().toString(36).slice(-16) + 'Aa1!',
      role:         'tenant',
      phoneNumber:  '0000000000',
      isVerified:   true,
      profilePhoto: profile.photos?.[0]?.value || null,
    });
  } else {
    if (!user.profilePhoto && profile.photos?.[0]?.value) {
      user.profilePhoto = profile.photos[0].value;
    }
    user.isVerified = true;
    user.lastLogin  = new Date();
    await user.save();
  }
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
        if (!email) return done(new Error('No email from Google'), null);
        const user = await _oauthUpsert(profile, email);
        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// ─── Facebook Strategy (only registered when credentials are available) ───────
if (FacebookStrategy && process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  passport.use(
    new FacebookStrategy(
      {
        clientID:     process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL:  `${process.env.SERVER_URL || 'http://localhost:5000'}/api/auth/facebook/callback`,
        profileFields: ['id', 'emails', 'name', 'displayName', 'photos'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            // Facebook accounts without a verified email cannot be used
            return done(new Error('No email returned from Facebook. Please ensure your Facebook account has a verified email.'), null);
          }
          const user = await _oauthUpsert(profile, email);
          return done(null, user);
        } catch (err) {
          return done(err, null);
        }
      }
    )
  );
  console.log('✅ Facebook OAuth strategy registered');
} else {
  console.log('ℹ️  Facebook OAuth not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET missing or passport-facebook not installed)');
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
