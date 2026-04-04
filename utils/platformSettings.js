const PlatformSetting = require('../models/PlatformSetting');

const DEFAULTS = {
  brandName: process.env.BRAND_NAME || 'RentifyPro',
  supportEmail: (process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || 'support@rentifypro.com').toLowerCase(),
  logoUrl: process.env.BRAND_LOGO_URL || '',
  faviconUrl: process.env.BRAND_FAVICON_URL || '/favicon.ico',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_OR_PATH_REGEX = /^(https?:\/\/|\/)[^\s]+$/i;
const CACHE_TTL_MS = 60 * 1000;

let cached = null;
let cachedAt = 0;

const normalizeBrandName = (value) => {
  const next = String(value || '').trim();
  return next || DEFAULTS.brandName;
};

const normalizeSupportEmail = (value) => {
  const next = String(value || '').trim().toLowerCase();
  return next || DEFAULTS.supportEmail;
};

const normalizeLogoUrl = (value) => {
  const next = String(value || '').trim();
  return next || DEFAULTS.logoUrl;
};

const normalizeFaviconUrl = (value) => {
  const next = String(value || '').trim();
  return next || DEFAULTS.faviconUrl;
};

const validateBrandingInput = ({ brandName, supportEmail, logoUrl, faviconUrl }) => {
  const name = normalizeBrandName(brandName);
  const email = normalizeSupportEmail(supportEmail);
  const normalizedLogoUrl = normalizeLogoUrl(logoUrl);
  const normalizedFaviconUrl = normalizeFaviconUrl(faviconUrl);

  if (name.length < 2 || name.length > 60) {
    return { ok: false, message: 'Brand name must be between 2 and 60 characters.' };
  }

  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, message: 'Support email must be a valid email address.' };
  }

  if (normalizedLogoUrl && !URL_OR_PATH_REGEX.test(normalizedLogoUrl)) {
    return { ok: false, message: 'Logo URL must start with http://, https://, or /' };
  }

  if (normalizedFaviconUrl && !URL_OR_PATH_REGEX.test(normalizedFaviconUrl)) {
    return { ok: false, message: 'Favicon URL must start with http://, https://, or /' };
  }

  return {
    ok: true,
    value: {
      brandName: name,
      supportEmail: email,
      logoUrl: normalizedLogoUrl,
      faviconUrl: normalizedFaviconUrl,
    },
  };
};

const readFromDb = async () => {
  const doc = await PlatformSetting.findOne({ key: 'singleton' }).lean();
  if (!doc) return { ...DEFAULTS };

  return {
    brandName: normalizeBrandName(doc.brandName),
    supportEmail: normalizeSupportEmail(doc.supportEmail),
    logoUrl: normalizeLogoUrl(doc.logoUrl),
    faviconUrl: normalizeFaviconUrl(doc.faviconUrl),
  };
};

const getPlatformBranding = async ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && cached && now - cachedAt < CACHE_TTL_MS) return cached;

  try {
    cached = await readFromDb();
    cachedAt = now;
    return cached;
  } catch {
    return { ...DEFAULTS };
  }
};

const upsertPlatformBranding = async ({ brandName, supportEmail, logoUrl, faviconUrl, updatedBy }) => {
  const validation = validateBrandingInput({ brandName, supportEmail, logoUrl, faviconUrl });
  if (!validation.ok) {
    const err = new Error(validation.message);
    err.statusCode = 400;
    throw err;
  }

  const { value } = validation;

  await PlatformSetting.findOneAndUpdate(
    { key: 'singleton' },
    { ...value, updatedBy: updatedBy || null },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  cached = { ...value };
  cachedAt = Date.now();
  return cached;
};

module.exports = {
  getPlatformBranding,
  upsertPlatformBranding,
  validateBrandingInput,
  DEFAULT_PLATFORM_BRANDING: DEFAULTS,
};