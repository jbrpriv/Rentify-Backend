const https = require('https');

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = {
  rates: { USD: 1 },
  updatedAt: 0,
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

async function getRates() {
  const now = Date.now();
  if (now - cache.updatedAt < CACHE_TTL_MS) {
    return cache.rates;
  }

  try {
    const data = await fetchJson('https://open.er-api.com/v6/latest/USD');
    if (data?.rates && typeof data.rates === 'object') {
      cache.rates = { USD: 1, ...data.rates };
      cache.updatedAt = now;
    }
  } catch (_) {
    // Keep last known rates on fetch failure.
  }

  return cache.rates;
}

function normalizeCurrency(input) {
  const code = String(input || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return 'USD';
  return code;
}

async function getCurrencyContext(inputCurrency) {
  const currency = normalizeCurrency(inputCurrency);
  const rates = await getRates();
  const rate = rates[currency] || 1;

  const money = (amount, opts = {}) => {
    const value = Number(amount || 0) * rate;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: opts.minimumFractionDigits ?? 0,
      maximumFractionDigits: opts.maximumFractionDigits ?? 0,
    }).format(value);
  };

  return { currency, rate, money };
}

module.exports = {
  getCurrencyContext,
  normalizeCurrency,
};
