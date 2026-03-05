const request = require('supertest');
const { createLandlord, createTenant, createAdmin, createProperty, createAgreement, authHeader } = require('./helpers');

jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('../utils/smsService', () => ({ sendOTP: jest.fn(), verifyOTP: jest.fn(), sendSMS: jest.fn() }));
jest.mock('../utils/firebaseService', () => ({ sendPushNotification: jest.fn() }));
jest.mock('../utils/s3Service', () => ({
    isS3Configured: jest.fn().mockReturnValue(false),
    uploadAgreementPDF: jest.fn(),
    getAgreementPDFUrl: jest.fn(),
}));
jest.mock('../utils/pdfGenerator', () => ({
    generateAgreementPDF: jest.fn((agreement, landlord, tenant, property, res) => res.end()),
    generateAgreementPDFBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
}));
jest.mock('../config/redis', () => ({ redisConnection: {}, redisClient: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));

let app;
beforeAll(() => { app = require('../server').app; });

// ─── POST /api/agreements ─────────────────────────────────────────────────────
describe('POST /api/agreements', () => {
    it('landlord can create a draft agreement', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);

        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 12);

        const res = await request(app)
            .post('/api/agreements')
            .set(authHeader(landlord._id))
            .send({
                tenantId: tenant._id.toString(),
                propertyId: property._id.toString(),
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                rentAmount: 25000,
                depositAmount: 50000,
            });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('draft');
        expect(res.body.landlord).toBe(landlord._id.toString());
        expect(res.body.tenant).toBe(tenant._id.toString());
    });

    it('returns 403 when landlord tries to create agreement for a property they don\'t own', async () => {
        const ownerLandlord = await createLandlord();
        const otherLandlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(ownerLandlord._id);

        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 12);

        const res = await request(app)
            .post('/api/agreements')
            .set(authHeader(otherLandlord._id))
            .send({
                tenantId: tenant._id.toString(),
                propertyId: property._id.toString(),
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                rentAmount: 25000,
                depositAmount: 50000,
            });
        expect(res.status).toBe(403);
    });

    it('returns 400 when endDate is before startDate', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);

        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() - 1); // past date

        const res = await request(app)
            .post('/api/agreements')
            .set(authHeader(landlord._id))
            .send({
                tenantId: tenant._id.toString(),
                propertyId: property._id.toString(),
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                rentAmount: 25000,
                depositAmount: 50000,
            });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/endDate must be after/i);
    });

    it('returns 400 when tenantId is not a tenant-role user', async () => {
        const landlord = await createLandlord();
        const anotherLandlord = await createLandlord();
        const property = await createProperty(landlord._id);

        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 12);

        const res = await request(app)
            .post('/api/agreements')
            .set(authHeader(landlord._id))
            .send({
                tenantId: anotherLandlord._id.toString(),
                propertyId: property._id.toString(),
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                rentAmount: 25000,
                depositAmount: 50000,
            });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/tenant account/i);
    });
});

// ─── GET /api/agreements ──────────────────────────────────────────────────────
describe('GET /api/agreements', () => {
    it('landlord only sees their own agreements', async () => {
        const landlordA = await createLandlord();
        const landlordB = await createLandlord();
        const tenant = await createTenant();
        const propA = await createProperty(landlordA._id);
        const propB = await createProperty(landlordB._id);

        await createAgreement(landlordA._id, tenant._id, propA._id);
        await createAgreement(landlordB._id, tenant._id, propB._id);

        const res = await request(app)
            .get('/api/agreements')
            .set(authHeader(landlordA._id));
        expect(res.status).toBe(200);
        expect(res.body.every(a =>
            a.landlord._id === landlordA._id.toString() ||
            a.landlord === landlordA._id.toString()
        )).toBe(true);
    });

    it('tenant only sees agreements where they are the tenant', async () => {
        const landlord = await createLandlord();
        const tenantA = await createTenant();
        const tenantB = await createTenant();
        const propA = await createProperty(landlord._id);
        const propB = await createProperty(landlord._id);

        await createAgreement(landlord._id, tenantA._id, propA._id);
        await createAgreement(landlord._id, tenantB._id, propB._id);

        const res = await request(app)
            .get('/api/agreements')
            .set(authHeader(tenantA._id));
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
    });

    it('admin can see all agreements', async () => {
        const landlordA = await createLandlord();
        const landlordB = await createLandlord();
        const tenant = await createTenant();
        const admin = await createAdmin();
        const propA = await createProperty(landlordA._id);
        const propB = await createProperty(landlordB._id);

        await createAgreement(landlordA._id, tenant._id, propA._id);
        await createAgreement(landlordB._id, tenant._id, propB._id);

        const res = await request(app)
            .get('/api/agreements')
            .set(authHeader(admin._id));
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
    });
});

// ─── PUT /api/agreements/:id/sign ─────────────────────────────────────────────
describe('PUT /api/agreements/:id/sign', () => {
    it('landlord can sign their agreement', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id);

        const res = await request(app)
            .put(`/api/agreements/${agreement._id}/sign`)
            .set(authHeader(landlord._id));
        expect(res.status).toBe(200);
        expect(res.body.signatures.landlord.signed).toBe(true);
    });

    it('tenant can sign their agreement', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id);

        const res = await request(app)
            .put(`/api/agreements/${agreement._id}/sign`)
            .set(authHeader(tenant._id));
        expect(res.status).toBe(200);
        expect(res.body.signatures.tenant.signed).toBe(true);
    });

    it('both parties signing sets status to "signed"', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id);

        await request(app)
            .put(`/api/agreements/${agreement._id}/sign`)
            .set(authHeader(landlord._id));

        const res = await request(app)
            .put(`/api/agreements/${agreement._id}/sign`)
            .set(authHeader(tenant._id));
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('signed');
    });

    it('cannot sign twice', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id);

        await request(app)
            .put(`/api/agreements/${agreement._id}/sign`)
            .set(authHeader(landlord._id));

        const res = await request(app)
            .put(`/api/agreements/${agreement._id}/sign`)
            .set(authHeader(landlord._id));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already signed/i);
    });

    it('unrelated user cannot sign', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const stranger = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id);

        const res = await request(app)
            .put(`/api/agreements/${agreement._id}/sign`)
            .set(authHeader(stranger._id));
        expect(res.status).toBe(403);
    });
});

// ─── POST /api/agreements/:id/renew ──────────────────────────────────────────
describe('Agreement renewal workflow', () => {
    it('landlord can propose renewal on active agreement', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, { status: 'active' });

        const newEndDate = new Date();
        newEndDate.setFullYear(newEndDate.getFullYear() + 2);

        const res = await request(app)
            .post(`/api/agreements/${agreement._id}/renew`)
            .set(authHeader(landlord._id))
            .send({ newEndDate: newEndDate.toISOString(), newRentAmount: 28000 });
        expect(res.status).toBe(200);
        expect(res.body.agreement.renewalProposal.status).toBe('pending');
    });

    it('tenant cannot propose renewal', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, { status: 'active' });

        const res = await request(app)
            .post(`/api/agreements/${agreement._id}/renew`)
            .set(authHeader(tenant._id))
            .send({ newEndDate: new Date().toISOString() });
        expect(res.status).toBe(403);
    });

    it('tenant can accept a renewal proposal', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const newEndDate = new Date();
        newEndDate.setFullYear(newEndDate.getFullYear() + 2);

        const agreement = await createAgreement(landlord._id, tenant._id, property._id, {
            status: 'active',
            renewalProposal: {
                proposedBy: landlord._id,
                newEndDate,
                newRentAmount: 28000,
                status: 'pending',
                proposedAt: new Date(),
            },
        });

        const res = await request(app)
            .put(`/api/agreements/${agreement._id}/renew/respond`)
            .set(authHeader(tenant._id))
            .send({ accept: true });
        expect(res.status).toBe(200);
        expect(res.body.agreement.renewalProposal.status).toBe('accepted');
    });

    it('tenant can reject a renewal proposal', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);

        const agreement = await createAgreement(landlord._id, tenant._id, property._id, {
            status: 'active',
            renewalProposal: {
                proposedBy: landlord._id,
                newEndDate: new Date(),
                newRentAmount: 30000,
                status: 'pending',
                proposedAt: new Date(),
            },
        });

        const res = await request(app)
            .put(`/api/agreements/${agreement._id}/renew/respond`)
            .set(authHeader(tenant._id))
            .send({ accept: false });
        expect(res.status).toBe(200);
        expect(res.body.agreement.renewalProposal.status).toBe('rejected');
    });
});

// ─── Agreement version history ────────────────────────────────────────────────
describe('GET /api/agreements/:id/version-history', () => {
    it('landlord can view version history', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id);

        const res = await request(app)
            .get(`/api/agreements/${agreement._id}/version-history`)
            .set(authHeader(landlord._id));
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('auditLog');
    });

    it('stranger cannot view version history', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const stranger = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id);

        const res = await request(app)
            .get(`/api/agreements/${agreement._id}/version-history`)
            .set(authHeader(stranger._id));
        expect(res.status).toBe(403);
    });
});

// ─── Token-based signing ──────────────────────────────────────────────────────
describe('POST /api/agreements/:id/sign-via-token', () => {
    it('can sign with a valid token', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);

        const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, {
            status: 'sent',
            signingTokens: [
                { party: 'tenant', token: 'validtoken123', expiresAt, used: false },
            ],
        });

        const res = await request(app)
            .post(`/api/agreements/${agreement._id}/sign-via-token`)
            .send({ token: 'validtoken123', party: 'tenant' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBeDefined();
    });

    it('returns 400 for invalid token', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, {
            status: 'sent',
            signingTokens: [],
        });

        const res = await request(app)
            .post(`/api/agreements/${agreement._id}/sign-via-token`)
            .send({ token: 'wrong_token', party: 'tenant' });
        expect(res.status).toBe(400);
    });
});