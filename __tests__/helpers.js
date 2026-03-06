const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Property = require('../models/Property');
const Agreement = require('../models/Agreement');

// ─── Token ────────────────────────────────────────────────────────────────────
const makeToken = (userId) =>
    jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

const authHeader = (userId) => ({ Authorization: `Bearer ${makeToken(userId)}` });

// ─── User factory ─────────────────────────────────────────────────────────────
const createUser = async (overrides = {}) => {
    const defaults = {
        name: 'Test User',
        email: `user_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
        password: 'Password123!',
        role: 'tenant',
        phoneNumber: '03001234567',
        isVerified: true,
        isPhoneVerified: true,
        isActive: true,
    };
    return User.create({ ...defaults, ...overrides });
};

const createLandlord = (overrides = {}) =>
    createUser({ role: 'landlord', name: 'Test Landlord', ...overrides });

const createTenant = (overrides = {}) =>
    createUser({ role: 'tenant', name: 'Test Tenant', ...overrides });

const createAdmin = (overrides = {}) =>
    createUser({ role: 'admin', name: 'Test Admin', ...overrides });

// ─── Property factory ─────────────────────────────────────────────────────────
const createProperty = async (landlordId, overrides = {}) => {
    const defaults = {
        landlord: landlordId,
        title: 'Test Property',
        type: 'apartment',
        address: { street: '123 Main St', city: 'Karachi', state: 'Sindh', zip: '75000', country: 'Pakistan' },
        specs: { bedrooms: 2, bathrooms: 1, areaSqft: 900 },
        financials: {
            monthlyRent: 25000,
            securityDeposit: 50000,
            lateFeeAmount: 1000,
            lateFeeGracePeriodDays: 5,
        },
        leaseTerms: { defaultDurationMonths: 12 },
        status: 'vacant',
        isListed: true,
    };
    return Property.create({ ...defaults, ...overrides });
};

// ─── Agreement factory ────────────────────────────────────────────────────────
const createAgreement = async (landlordId, tenantId, propertyId, overrides = {}) => {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 12);

    const defaults = {
        landlord: landlordId,
        tenant: tenantId,
        property: propertyId,
        status: 'draft',
        signerOrder: 'any',
        term: { startDate, endDate, durationMonths: 12 },
        financials: { rentAmount: 25000, depositAmount: 50000, lateFeeAmount: 1000, lateFeeGracePeriodDays: 5 },
        signatures: {
            landlord: { signed: false },
            tenant: { signed: false },
        },
        auditLog: [{ action: 'CREATED', actor: landlordId, details: 'Test agreement' }],
    };
    return Agreement.create({ ...defaults, ...overrides });
};

module.exports = {
    makeToken,
    authHeader,
    createUser,
    createLandlord,
    createTenant,
    createAdmin,
    createProperty,
    createAgreement,
};