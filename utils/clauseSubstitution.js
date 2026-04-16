/**
 * utils/clauseSubstitution.js
 *
 * [FIX #4]  Adds evaluateCondition() and applies it inside substituteClauses()
 *           so clauses with a failing condition are excluded from the PDF.
 *
 * Supported operators:
 *   eq       — strict equality
 *   ne       — not equal
 *   gt/gte   — numeric greater than (or equal)
 *   lt/lte   — numeric less than (or equal)
 *   exists   — field is not null/undefined/empty — `value` is ignored
 *   in       — field value is one of the array in `value`
 *   contains — field string contains `value` as a substring (case-insensitive)
 */

const _fmt = {
  money: (n) => (n ?? 0).toLocaleString('en-PK'),
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
 * @param {object} agreement - Mongoose agreement doc with populated landlord/tenant/property.
 * @returns {Record<string, string>}
 */
function buildVariableMap(agreement) {
  const { landlord, tenant, property, term, financials } = agreement;

  const address = property?.address
    ? [property.address.street, property.address.city, property.address.state]
        .filter(Boolean).join(', ')
    : '';

  // Derived helpers for common aliases used by the frontend editor
  const _durationVal = term?.durationMonths ?? null;
  const _durationStr = _durationVal ? String(_durationVal) : '—';
  const _maintenanceVal = (financials && financials.maintenanceFee) || property?.financials?.maintenanceFee || property?.maintenanceFee || 0;
  const _maintenanceStr = _fmt.money(_maintenanceVal);

  return {
    // CamelCase (Legacy Support)
    tenantName:        tenant?.name       || '____________________',
    landlordName:      landlord?.name     || '____________________',
    propertyTitle:     property?.title    || '____________________',
    propertyAddress:   address            || '____________________',
    rentAmount:        _fmt.money(financials?.rentAmount),
    depositAmount:     _fmt.money(financials?.depositAmount),
    startDate:         _fmt.date(term?.startDate),
    endDate:           _fmt.date(term?.endDate),

    // snake_case (Modern Builder Support)
    agreement_id:      String(agreement._id),
    current_date:      _fmt.date(new Date()),
    tenant_name:       tenant?.name       || '____________________',
    landlord_name:     landlord?.name     || '____________________',
    property_title:    property?.title    || '____________________',
    property_address:  address           || '____________________',
    rent_amount:       _fmt.money(financials?.rentAmount),
    monthly_rent:      _fmt.money(financials?.rentAmount),
    security_deposit:  _fmt.money(financials?.depositAmount),
    total_move_in:     _fmt.money((financials?.rentAmount || 0) + (financials?.depositAmount || 0)),
    start_date:        _fmt.date(term?.startDate),
    end_date:          _fmt.date(term?.endDate),
    lease_end_date:    _fmt.date(term?.endDate),
    duration_months:   term?.durationMonths || '—',
    // Aliases expected by the Agreement Builder / templates
    durationMonths:    _durationStr,
    lease_duration:    _durationStr,
    leaseDuration:     _durationStr,
    duration:          _durationStr,
    pet_allowed:       agreement.petPolicy?.allowed ? 'Allowed' : 'Not Allowed',
    pet_deposit:       _fmt.money(agreement.petPolicy?.deposit || 0),
    utilities_included: agreement.utilitiesIncluded ? 'Included' : 'Not Included',
    // Other fields
    lateFeeAmount:     _fmt.money(financials?.lateFeeAmount),
    // friendly aliases for templates
    late_fee:          _fmt.money(financials?.lateFeeAmount),
    lateFee:           _fmt.money(financials?.lateFeeAmount),
    late_fee_amount:   _fmt.money(financials?.lateFeeAmount),
    maintenance_fee:   _maintenanceStr,
    maintenanceFee:    _maintenanceStr,
    lateFeeGraceDays:  String(financials?.lateFeeGracePeriodDays ?? 5),
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
 * Unknown variables are left as-is.
 *
 * @param {string} text
 * @param {Record<string, string>} vars
 * @returns {string}
 */
function substituteVariables(text, vars) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}

// ─── [FIX #4] Condition evaluator ────────────────────────────────────────────

/**
 * Resolve a dot-notation path from a plain object.
 * e.g. resolvePath({ a: { b: 3 } }, 'a.b') → 3
 */
function resolvePath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

/**
 * Evaluate a clause condition against a raw agreement plain object.
 *
 * @param {object|null} condition  - The condition sub-document from the Clause.
 * @param {object}      agreement  - The agreement plain object (toObject() or lean()).
 * @returns {boolean}  true if the clause should be included; false if it should be skipped.
 */
function evaluateCondition(condition, agreement) {
  // No condition → always include
  if (!condition || !condition.field) return true;

  const { field, operator = 'eq', value } = condition;
  const actual = resolvePath(agreement, field);

  switch (operator) {
    case 'eq':
      return actual == value; // intentional == for type coercion (string "true" vs bool)

    case 'ne':
      return actual != value;

    case 'gt':
      return Number(actual) > Number(value);

    case 'gte':
      return Number(actual) >= Number(value);

    case 'lt':
      return Number(actual) < Number(value);

    case 'lte':
      return Number(actual) <= Number(value);

    case 'exists':
      return actual !== null && actual !== undefined && actual !== '' && actual !== false;

    case 'in':
      return Array.isArray(value) && value.includes(actual);

    case 'contains':
      return typeof actual === 'string' &&
             actual.toLowerCase().includes(String(value).toLowerCase());

    default:
      return true;
  }
}

/**
 * Apply variable substitution to every clause in an agreement's clauseSet,
 * skipping clauses whose condition evaluates to false.
 *
 * [FIX #4] Each clause in the clauseSet may now carry a `condition` field.
 *          Clauses that fail their condition are excluded from the output
 *          (and therefore from the generated PDF).
 *
 * @param {object} agreement - Populated Mongoose agreement document.
 * @returns {Array<{clauseId, title, body}>}
 */
function substituteClauses(agreement) {
  if (!agreement.clauseSet || agreement.clauseSet.length === 0) return [];

  const vars        = buildVariableMap(agreement);
  const agreementObj = typeof agreement.toObject === 'function'
    ? agreement.toObject()
    : agreement;

  const result = [];

  for (const clause of agreement.clauseSet) {
    // [FIX #4] Evaluate condition before including the clause
    if (!evaluateCondition(clause.condition, agreementObj)) {
      continue; // clause condition not met — skip this clause
    }

    result.push({
      clauseId: clause.clauseId,
      title:    clause.title,
      body:     substituteVariables(clause.body, vars),
    });
  }

  return result;
}

module.exports = {
  buildVariableMap,
  substituteVariables,
  substituteClauses,
  evaluateCondition,  // exported for unit testing
  resolvePath,
};
