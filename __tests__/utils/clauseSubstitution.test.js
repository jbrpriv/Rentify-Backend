const {
  buildVariableMap,
  substituteVariables,
  evaluateCondition,
  substituteClauses,
} = require('../../utils/clauseSubstitution');

// ── Shared fixture ────────────────────────────────────────────────────────────
const baseAgreement = {
  _id: 'agr001',
  landlord:  { name: 'Alice Smith' },
  tenant:    { name: 'Bob Jones'   },
  property:  {
    title:   'Sunset Apartment',
    address: { street: '12 Main St', city: 'Karachi', state: 'Sindh' },
  },
  term: {
    startDate:      new Date('2024-01-01'),
    endDate:        new Date('2024-12-31'),
    durationMonths: 12,
  },
  financials: {
    rentAmount:             50000,
    depositAmount:          100000,
    lateFeeAmount:          2000,
    lateFeeGracePeriodDays: 5,
  },
  petPolicy:          { allowed: true, deposit: 5000 },
  utilitiesIncluded:  true,
  utilitiesDetails:   'Water and electricity',
  terminationPolicy:  '30-day notice',
  clauseSet:          [],
  toObject() { return { ...this }; },
};

// ── buildVariableMap ──────────────────────────────────────────────────────────
describe('buildVariableMap', () => {
  let vars;
  beforeAll(() => { vars = buildVariableMap(baseAgreement); });

  it('maps tenant and landlord names', () => {
    expect(vars.tenantName).toBe('Bob Jones');
    expect(vars.landlordName).toBe('Alice Smith');
  });

  it('maps property title', () => {
    expect(vars.propertyTitle).toBe('Sunset Apartment');
  });

  it('formats money values (contains digits)', () => {
    expect(vars.rentAmount).toMatch(/\d/);
    expect(vars.depositAmount).toMatch(/\d/);
  });

  it('maps durationMonths as a string', () => {
    expect(vars.durationMonths).toBe('12');
  });

  it('maps petPolicy when pets are allowed', () => {
    expect(vars.petPolicy).toBe('Pets allowed');
  });

  it('maps utilitiesIncluded: true → "Utilities included"', () => {
    expect(vars.utilities).toBe('Utilities included');
  });

  it('maps utilitiesIncluded: false → "Utilities not included"', () => {
    const v = buildVariableMap({ ...baseAgreement, utilitiesIncluded: false });
    expect(v.utilities).toBe('Utilities not included');
  });

  it('uses placeholder dashes when landlord/tenant/property are missing', () => {
    const v = buildVariableMap({ ...baseAgreement, landlord: {}, tenant: {}, property: {} });
    expect(v.tenantName).toBe('____________________');
    expect(v.landlordName).toBe('____________________');
    expect(v.propertyTitle).toBe('____________________');
  });

  it('returns "—" for a null date', () => {
    const v = buildVariableMap({ ...baseAgreement, term: { startDate: null } });
    expect(v.startDate).toBe('—');
  });

  it('formats non-null dates as non-empty strings', () => {
    expect(vars.startDate.length).toBeGreaterThan(0);
    expect(vars.startDate).not.toBe('—');
  });
});

// ── substituteVariables ───────────────────────────────────────────────────────
describe('substituteVariables', () => {
  const vars = { tenantName: 'Bob Jones', rentAmount: '50,000' };

  it('replaces a single {{variable}}', () => {
    expect(substituteVariables('Hello {{tenantName}}', vars)).toBe('Hello Bob Jones');
  });

  it('replaces multiple variables in one pass', () => {
    expect(substituteVariables('Rent: {{rentAmount}}, Tenant: {{tenantName}}', vars))
      .toBe('Rent: 50,000, Tenant: Bob Jones');
  });

  it('leaves unknown placeholders unchanged', () => {
    expect(substituteVariables('Amount: {{unknown}}', vars)).toBe('Amount: {{unknown}}');
  });

  it('returns empty string for null input', () => {
    expect(substituteVariables(null, vars)).toBe('');
  });

  it('returns empty string for undefined input', () => {
    expect(substituteVariables(undefined, vars)).toBe('');
  });

  it('passes through strings with no placeholders', () => {
    expect(substituteVariables('No placeholders.', vars)).toBe('No placeholders.');
  });
});

// ── evaluateCondition ─────────────────────────────────────────────────────────
describe('evaluateCondition', () => {
  const agr = {
    petPolicy:         { allowed: true },
    financials:        { rentAmount: 50000 },
    utilitiesIncluded: true,
    category:          'residential',
  };

  it('returns true when condition is null', () => {
    expect(evaluateCondition(null, agr)).toBe(true);
  });

  it('returns true when condition has no field', () => {
    expect(evaluateCondition({}, agr)).toBe(true);
  });

  describe('eq', () => {
    it('passes when values match',  () => expect(evaluateCondition({ field: 'petPolicy.allowed', operator: 'eq', value: true  }, agr)).toBe(true));
    it('fails when values differ',  () => expect(evaluateCondition({ field: 'petPolicy.allowed', operator: 'eq', value: false }, agr)).toBe(false));
  });

  describe('ne', () => {
    it('passes when values differ', () => expect(evaluateCondition({ field: 'utilitiesIncluded', operator: 'ne', value: false }, agr)).toBe(true));
    it('fails when values match',   () => expect(evaluateCondition({ field: 'utilitiesIncluded', operator: 'ne', value: true  }, agr)).toBe(false));
  });

  describe('gt', () => {
    it('passes when actual > value', () => expect(evaluateCondition({ field: 'financials.rentAmount', operator: 'gt', value: 40000 }, agr)).toBe(true));
    it('fails when actual <= value', () => expect(evaluateCondition({ field: 'financials.rentAmount', operator: 'gt', value: 60000 }, agr)).toBe(false));
    it('fails on equality',          () => expect(evaluateCondition({ field: 'financials.rentAmount', operator: 'gt', value: 50000 }, agr)).toBe(false));
  });

  describe('gte', () => {
    it('passes on equality',         () => expect(evaluateCondition({ field: 'financials.rentAmount', operator: 'gte', value: 50000 }, agr)).toBe(true));
    it('fails when actual < value',  () => expect(evaluateCondition({ field: 'financials.rentAmount', operator: 'gte', value: 60000 }, agr)).toBe(false));
  });

  describe('lt', () => {
    it('passes when actual < value', () => expect(evaluateCondition({ field: 'financials.rentAmount', operator: 'lt', value: 60000 }, agr)).toBe(true));
    it('fails when actual >= value', () => expect(evaluateCondition({ field: 'financials.rentAmount', operator: 'lt', value: 50000 }, agr)).toBe(false));
  });

  describe('lte', () => {
    it('passes on equality',         () => expect(evaluateCondition({ field: 'financials.rentAmount', operator: 'lte', value: 50000 }, agr)).toBe(true));
    it('fails when actual > value',  () => expect(evaluateCondition({ field: 'financials.rentAmount', operator: 'lte', value: 40000 }, agr)).toBe(false));
  });

  describe('exists', () => {
    it('passes for a truthy field',              () => expect(evaluateCondition({ field: 'category',    operator: 'exists' }, agr)).toBe(true));
    it('fails for an absent field',              () => expect(evaluateCondition({ field: 'noSuchField', operator: 'exists' }, agr)).toBe(false));
    it('fails for an empty-string field value',  () => expect(evaluateCondition({ field: 'empty',       operator: 'exists' }, { empty: '' })).toBe(false));
  });

  describe('in', () => {
    it('passes when actual is in the array',     () => expect(evaluateCondition({ field: 'category', operator: 'in', value: ['residential', 'commercial'] }, agr)).toBe(true));
    it('fails when actual is not in the array',  () => expect(evaluateCondition({ field: 'category', operator: 'in', value: ['industrial']               }, agr)).toBe(false));
  });

  describe('contains', () => {
    it('passes with case-insensitive substring', () => expect(evaluateCondition({ field: 'category', operator: 'contains', value: 'RESID' }, agr)).toBe(true));
    it('fails when not a substring',             () => expect(evaluateCondition({ field: 'category', operator: 'contains', value: 'xyz'   }, agr)).toBe(false));
  });

  it('unknown operator returns true (permissive default)', () => {
    expect(evaluateCondition({ field: 'category', operator: 'unknown_op', value: 'x' }, agr)).toBe(true);
  });
});

// ── substituteClauses ─────────────────────────────────────────────────────────
describe('substituteClauses', () => {
  it('returns [] when clauseSet is empty', () => {
    expect(substituteClauses({ ...baseAgreement, clauseSet: [] })).toEqual([]);
  });

  it('returns [] when clauseSet is absent', () => {
    const { clauseSet, ...rest } = baseAgreement;
    expect(substituteClauses(rest)).toEqual([]);
  });

  it('substitutes variables in clause body', () => {
    const agr = {
      ...baseAgreement,
      clauseSet: [{ clauseId: 'c1', title: 'Rent', body: 'Rent is PKR {{rentAmount}}.', condition: null }],
    };
    const result = substituteClauses(agr);
    expect(result).toHaveLength(1);
    expect(result[0].body).toMatch(/\d/);   // money was substituted
    expect(result[0].title).toBe('Rent');
  });

  it('skips clauses whose condition fails', () => {
    const agr = {
      ...baseAgreement,
      petPolicy: { allowed: false },
      clauseSet: [{
        clauseId: 'pet1', title: 'Pet Clause', body: 'Pets welcome.',
        condition: { field: 'petPolicy.allowed', operator: 'eq', value: true },
      }],
    };
    expect(substituteClauses(agr)).toHaveLength(0);
  });

  it('includes clauses whose condition passes', () => {
    const agr = {
      ...baseAgreement,
      petPolicy: { allowed: true },
      clauseSet: [{
        clauseId: 'pet1', title: 'Pet Clause', body: 'Pets welcome.',
        condition: { field: 'petPolicy.allowed', operator: 'eq', value: true },
      }],
    };
    const result = substituteClauses(agr);
    expect(result).toHaveLength(1);
    expect(result[0].clauseId).toBe('pet1');
  });

  it('handles a mix of passing and failing conditions', () => {
    const agr = {
      ...baseAgreement,
      petPolicy: { allowed: false },
      clauseSet: [
        { clauseId: 'always', title: 'Standard', body: 'Always here.', condition: null },
        { clauseId: 'pet',    title: 'Pet',      body: 'Pets welcome.',
          condition: { field: 'petPolicy.allowed', operator: 'eq', value: true } },
      ],
    };
    const result = substituteClauses(agr);
    expect(result).toHaveLength(1);
    expect(result[0].clauseId).toBe('always');
  });

  it('preserves clauseId and title in the output', () => {
    const agr = {
      ...baseAgreement,
      clauseSet: [{ clauseId: 'c99', title: 'My Clause', body: 'Hello {{tenantName}}.', condition: null }],
    };
    const [clause] = substituteClauses(agr);
    expect(clause.clauseId).toBe('c99');
    expect(clause.title).toBe('My Clause');
  });
});
