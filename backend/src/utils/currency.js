// src/utils/currency.js
//
// Every tenant's money is denominated in that tenant's own currency. Before
// this existed the code hardcoded 'BRL' in three places — a leftover from the
// template ASOS was built from — which left 859 leads labelled in Brazilian
// real and, worse, reported won deals to the Meta Conversions API as BRL. Meta
// values 1 BRL at roughly 50 PKR, so those conversions were reported at about
// 35x their real worth, skewing value optimisation.
//
// The currency lives in tenant.settings.defaultCurrency so a tenant sold to
// abroad can be set to their own without a migration. PKR is the fallback
// because every current tenant is Pakistani; a tenant that has not set one
// still gets a sane answer rather than another country's money.

const FALLBACK_CURRENCY = 'PKR';

// ISO 4217 is three uppercase letters. Anything else is a misconfiguration and
// falls back rather than propagating into Meta events and lead records.
const isValidCode = (code) => typeof code === 'string' && /^[A-Z]{3}$/.test(code);

// Accepts a tenant record (or anything carrying a settings blob). Safe on null.
const tenantCurrency = (tenant) => {
  const settings = tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
  const code = typeof settings.defaultCurrency === 'string'
    ? settings.defaultCurrency.trim().toUpperCase()
    : null;
  return isValidCode(code) ? code : FALLBACK_CURRENCY;
};

// Resolution order for a specific amount: what the caller explicitly passed,
// then what the record already carries, then the tenant's default.
const resolveCurrency = ({ explicit, existing, tenant } = {}) => {
  for (const candidate of [explicit, existing]) {
    if (typeof candidate === 'string') {
      const code = candidate.trim().toUpperCase();
      if (isValidCode(code)) return code;
    }
  }
  return tenantCurrency(tenant);
};

module.exports = { FALLBACK_CURRENCY, isValidCode, tenantCurrency, resolveCurrency };
