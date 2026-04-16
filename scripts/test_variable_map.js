#!/usr/bin/env node
const { buildVariableMap } = require('../utils/clauseSubstitution');

const sampleAgreement = {
  _id: 'agr-test-001',
  landlord: { name: 'Alice Landlord', email: 'alice@example.com' },
  tenant: { name: 'Bob Tenant', email: 'bob@example.com' },
  property: {
    title: 'Sample House',
    address: { street: '123 Main St', city: 'Sample City', state: 'Sample State' },
    financials: { maintenanceFee: 120 },
  },
  term: {
    startDate: new Date('2025-01-01'),
    endDate: new Date('2026-01-01'),
    durationMonths: 12,
  },
  financials: {
    rentAmount: 50000,
    depositAmount: 100000,
    lateFeeAmount: 2000,
    lateFeeGracePeriodDays: 7,
  },
  petPolicy: { allowed: false, deposit: 0 },
  utilitiesIncluded: false,
};

const vars = buildVariableMap(sampleAgreement);
console.log(JSON.stringify(vars, null, 2));
