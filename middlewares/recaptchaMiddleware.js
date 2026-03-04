const https = require('https');
const querystring = require('querystring');

/**
 * Google reCAPTCHA v3 verification middleware.
 *
 * Clients must send { recaptchaToken: "<token>" } in the request body.
 * Set RECAPTCHA_SECRET_KEY in .env.
 * Set RECAPTCHA_MIN_SCORE (default 0.5) to adjust sensitivity.
 *
 * Skip verification in test / development environments by setting
 * RECAPTCHA_DISABLED=true in .env.
 */
const verifyRecaptcha = async (req, res, next) => {
  // Allow disabling for local dev / CI
  if (process.env.RECAPTCHA_DISABLED === 'true') {
    return next();
  }

  const token = req.body?.recaptchaToken;

  if (!token) {
    return res.status(400).json({ message: 'reCAPTCHA token is required.' });
  }

  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  if (!secretKey) {
    // Misconfiguration — fail open with a warning so the platform still works
    // if the operator forgets to set the env var during initial deployment.
    console.warn('⚠️  RECAPTCHA_SECRET_KEY not set — skipping reCAPTCHA verification.');
    return next();
  }

  try {
    const score = await _verifyToken(token, secretKey, req.ip);
    const minScore = parseFloat(process.env.RECAPTCHA_MIN_SCORE || '0.5');

    if (score === null) {
      return res.status(400).json({ message: 'reCAPTCHA verification failed. Please try again.' });
    }

    if (score < minScore) {
      return res.status(403).json({
        message: 'reCAPTCHA score too low — possible bot activity. Please try again.',
      });
    }

    // Attach score for logging / downstream use
    req.recaptchaScore = score;
    return next();
  } catch (err) {
    console.error('reCAPTCHA error:', err.message);
    // Fail open — don't block real users if Google is temporarily unreachable
    return next();
  }
};

/**
 * Calls the Google reCAPTCHA siteverify API.
 * Returns the numeric score (0.0–1.0) or null on failure.
 */
function _verifyToken(token, secretKey, remoteIp) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      secret: secretKey,
      response: token,
      remoteip: remoteIp,
    });

    const options = {
      hostname: 'www.google.com',
      path: '/recaptcha/api/siteverify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.success) {
            resolve(parsed.score ?? 1.0);
          } else {
            const codes = parsed['error-codes'] || [];
            console.warn('reCAPTCHA failure codes:', codes);

            // 'timeout-or-duplicate' means the token expired (user took too long)
            // or was already consumed by a previous attempt (user retried after a
            // wrong password). Both cases are characteristic of real users, not
            // bots. Fail open so legitimate users aren't blocked on retry.
            if (codes.includes('timeout-or-duplicate')) {
              resolve(1.0); // treat as trusted, let loginUser decide
            } else {
              resolve(null); // genuinely invalid token — block
            }
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

module.exports = { verifyRecaptcha };