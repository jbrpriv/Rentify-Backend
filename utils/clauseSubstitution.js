/**
 * Clause Variable Substitution Engine — clauseSubstitution.js
 *
 * Resolves {{variable}} placeholders inside clause bodies using
 * values derived from an Agreement document (with populated relations).
 *
 * Supported variables:
 *   {{tenantName}}           — Tenant's full name
 *   {{landlordName}}         — Landlord's full name
 *   {{propertyTitle}}        — Property title / name
 *   {{propertyAddress}}      — Formatted address string
 *   {{rentAmount}}           — Monthly rent (formatted with commas)
 *   {{depositAmount}}        — Security deposit amount
 *   {{lateFeeAmount}}        — Late fee amount
 *   {{lateFeeGraceDays}}     — Grace period days before late fee applies
 *   {{startDate}}            — Lease start date (human-readable)
 *   {{endDate}}              — Lease end date (human-readable)
 *   {{durationMonths}}       — Lease duration in months
 *   {{currentDate}}          — Today's date
 *   {{agreementId}}          — Agreement ObjectId string
 *   {{petPolicy}}            — "Pets allowed" or "No pets"
 *   {{petDeposit}}           — Pet deposit amount (if pets allowed)
 *   {{utilities}}            — "Utilities included" or "Utilities not included"
 *   {{utilitiesDetails}}     — Detail string if provided
 *   {{terminationPolicy}}    — Termination policy text
 */

const _fmt = {
  /** Format a number with thousand separators */
  money: (n) => (n ?? 0).toLocaleString('en-PK'),

  /** Format a Date or date-string in human-readable form */
  date: (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-PK', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  },
};

/**
 * Build the substitution map from a populated Agreement document.
 *
 * @param {object} agreement - Mongoose agreement document with populated
 *   { landlord, tenant, property } fields.
 * @returns {Record<string, string>}
 */
function buildVariableMap(agreement) {
  const { landlord, tenant, property, term, financials } = agreement;

  const address = property?.address
    ? [
        property.address.street,
        property.address.city,
        property.address.state,
      ].filter(Boolean).join(', ')
    : '';

  return {
    tenantName:        tenant?.name       || '____________________',
    landlordName:      landlord?.name     || '____________________',
    propertyTitle:     property?.title    || '____________________',
    propertyAddress:   address            || '____________________',
    rentAmount:        _fmt.money(financials?.rentAmount),
    depositAmount:     _fmt.money(financials?.depositAmount),
    lateFeeAmount:     _fmt.money(financials?.lateFeeAmount),
    lateFeeGraceDays:  String(financials?.lateFeeGracePeriodDays ?? 5),
    startDate:         _fmt.date(term?.startDate),
    endDate:           _fmt.date(term?.endDate),
    durationMonths:    String(term?.durationMonths ?? ''),
    currentDate:       _fmt.date(new Date()),
    agreementId:       String(agreement._id),
    petPolicy:         agreement.petPolicy?.allowed ? 'Pets allowed' : 'No pets',
    petDeposit:        _fmt.money(agreement.petPolicy?.deposit),
    utilities:         agreement.utilitiesIncluded ? 'Utilities included' : 'Utilities not included',
    utilitiesDetails:  agreement.utilitiesDetails  || '',
    terminationPolicy: agreement.terminationPolicy || '',
  };
}

/**
 * Replace all {{variable}} occurrences in a string.
 *
 * Unknown variables are left as-is (not replaced) so they remain visible
 * in the PDF as a hint to the agreement author.
 *
 * @param {string} text      - Raw clause body text containing placeholders.
 * @param {Record<string, string>} vars - Map produced by buildVariableMap().
 * @returns {string}
 */
function substituteVariables(text, vars) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}

/**
 * Apply variable substitution to every clause in an agreement's clauseSet.
 *
 * Modifies the clause bodies in place on plain-object copies — does NOT
 * mutate the Mongoose document.
 *
 * @param {object} agreement - Populated Mongoose agreement document.
 * @returns {Array<{clauseId, title, body}>} Array of clauses with substituted bodies.
 */
function substituteClauses(agreement) {
  if (!agreement.clauseSet || agreement.clauseSet.length === 0) return [];

  const vars = buildVariableMap(agreement);

  return agreement.clauseSet.map((clause) => ({
    clauseId: clause.clauseId,
    title:    clause.title,
    body:     substituteVariables(clause.body, vars),
  }));
}

module.exports = { buildVariableMap, substituteVariables, substituteClauses };
