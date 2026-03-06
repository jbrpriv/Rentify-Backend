const request = require('supertest');
const { createLandlord, createTenant, createAdmin, createProperty, createAgreement, authHeader } = require('./helpers');

jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('../utils/smsService', () => ({ sendOTP: jest.fn(), verifyOTP: jest.fn(), sendSMS: jest.fn() }));
jest.mock('../utils/firebaseService', () => ({ sendPushNotification: jest.fn() }));
jest.mock('../config/redis', () => ({ redisConnection: {}, redisClient: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../utils/s3Service', () => ({
    isS3Configured: jest.fn().mockReturnValue(false),
    uploadAgreementPDF: jest.fn(),
}));
jest.mock('stripe', () => () => ({
    checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/pay' }) } },
    customers: {
        create: jest.fn().mockResolvedValue({ id: 'cus_test123' }),
        retrieve: jest.fn().mockResolvedValue({ metadata: {} }),
    },
    webhooks: { constructEvent: jest.fn() },
    billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://billing.test' }) } },
}));

let app;
beforeAll(() => { app = require('../server').app; });

// ─── ADMIN ────────────────────────────────────────────────────────────────────

describe('Admin endpoints', () => {
    it('GET /api/admin/stats returns platform stats', async () => {
        const admin = await createAdmin();
        const res = await request(app).get('/api/admin/stats').set(authHeader(admin._id));
        expect(res.status).toBe(200);
        expect(res.body.totals).toHaveProperty('users');
        expect(res.body.totals).toHaveProperty('agreements');
    });

    it('non-admin cannot access admin stats', async () => {
        const tenant = await createTenant();
        const res = await request(app).get('/api/admin/stats').set(authHeader(tenant._id));
        expect(res.status).toBe(403);
    });

    it('GET /api/admin/users returns paginated user list', async () => {
        const admin = await createAdmin();
        await createTenant();
        await createLandlord();
        const res = await request(app).get('/api/admin/users').set(authHeader(admin._id));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.users)).toBe(true);
        expect(res.body.pagination).toBeDefined();
    });

    it('admin can ban a user', async () => {
        const admin = await createAdmin();
        const user = await createTenant();
        const res = await request(app)
            .put(`/api/admin/users/${user._id}/ban`)
            .set(authHeader(admin._id));
        expect(res.status).toBe(200);
        expect(res.body.isActive).toBe(false);
    });

    it('admin can unban a user', async () => {
        const admin = await createAdmin();
        const user = await createTenant({ isActive: false });
        const res = await request(app)
            .put(`/api/admin/users/${user._id}/ban`)
            .set(authHeader(admin._id));
        expect(res.status).toBe(200);
        expect(res.body.isActive).toBe(true);
    });

    it('admin cannot ban themselves', async () => {
        const admin = await createAdmin();
        const res = await request(app)
            .put(`/api/admin/users/${admin._id}/ban`)
            .set(authHeader(admin._id));
        expect(res.status).toBe(400);
    });

    it('admin can change user role', async () => {
        const admin = await createAdmin();
        const user = await createTenant();
        const res = await request(app)
            .put(`/api/admin/users/${user._id}/role`)
            .set(authHeader(admin._id))
            .send({ role: 'landlord' });
        expect(res.status).toBe(200);
        expect(res.body.user.role).toBe('landlord');
    });

    it('admin cannot set an invalid role', async () => {
        const admin = await createAdmin();
        const user = await createTenant();
        const res = await request(app)
            .put(`/api/admin/users/${user._id}/role`)
            .set(authHeader(admin._id))
            .send({ role: 'superuser' });
        expect(res.status).toBe(400);
    });

    it('GET /api/admin/agreements returns all agreements', async () => {
        const admin = await createAdmin();
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        await createAgreement(landlord._id, tenant._id, property._id);

        const res = await request(app).get('/api/admin/agreements').set(authHeader(admin._id));
        expect(res.status).toBe(200);
        expect(res.body.agreements.length).toBeGreaterThan(0);
    });

    it('GET /api/admin/audit-logs returns audit entries', async () => {
        const admin = await createAdmin();
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        await createAgreement(landlord._id, tenant._id, property._id);

        const res = await request(app).get('/api/admin/audit-logs').set(authHeader(admin._id));
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('logs');
    });
});

// ─── USER PROFILE ─────────────────────────────────────────────────────────────

describe('User profile endpoints', () => {
    it('GET /api/users/profile returns current user', async () => {
        const user = await createLandlord({ name: 'Profile User' });
        const res = await request(app).get('/api/users/profile').set(authHeader(user._id));
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Profile User');
    });

    it('PUT /api/users/profile updates name', async () => {
        const user = await createLandlord();
        const res = await request(app)
            .put('/api/users/profile')
            .set(authHeader(user._id))
            .send({ name: 'Updated Name' });
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Updated Name');
    });

    it('POST /api/users/lookup finds user by email', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant({ email: 'findme@test.com' });
        const res = await request(app)
            .post('/api/users/lookup')
            .set(authHeader(landlord._id))
            .send({ email: 'findme@test.com' });
        expect(res.status).toBe(200);
        expect(res.body.email).toBe('findme@test.com');
    });

    it('POST /api/users/lookup returns 404 for unknown email', async () => {
        const landlord = await createLandlord();
        const res = await request(app)
            .post('/api/users/lookup')
            .set(authHeader(landlord._id))
            .send({ email: 'nobody@ghost.com' });
        expect(res.status).toBe(404);
    });
});

// ─── OFFERS ───────────────────────────────────────────────────────────────────

describe('Offers', () => {
    it('tenant can submit an offer on a listed property', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id, { isListed: true, status: 'vacant' });

        const res = await request(app)
            .post('/api/offers')
            .set(authHeader(tenant._id))
            .send({
                propertyId: property._id.toString(),
                monthlyRent: 23000,
                securityDeposit: 46000,
                leaseDurationMonths: 12,
            });
        expect(res.status).toBe(201);
    });

    it('landlord cannot submit an offer', async () => {
        const landlord = await createLandlord();
        const property = await createProperty(landlord._id, { isListed: true, status: 'vacant' });

        const res = await request(app)
            .post('/api/offers')
            .set(authHeader(landlord._id))
            .send({ propertyId: property._id.toString(), monthlyRent: 23000, securityDeposit: 46000, leaseDurationMonths: 12 });
        expect(res.status).toBe(403);
    });

    it('tenant cannot submit two active offers on same property', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id, { isListed: true, status: 'vacant' });

        // First offer
        const res1 = await request(app).post('/api/offers').set(authHeader(tenant._id))
            .send({ propertyId: property._id.toString(), monthlyRent: 23000, securityDeposit: 46000, leaseDurationMonths: 12 });

        if (res1.status !== 201) console.log('[DEBUG OFFER 1 FAILED]:', res1.body);

        // Second offer (Should fail with 409 Conflict)
        const res2 = await request(app).post('/api/offers').set(authHeader(tenant._id))
            .send({ propertyId: property._id.toString(), monthlyRent: 24000, securityDeposit: 48000, leaseDurationMonths: 12 });

        if (res2.status !== 409) console.log('[DEBUG OFFER 2 UNEXPECTED STATUS]:', res2.status, res2.body);

        expect(res2.status).toBe(409);
    });

    it('landlord can decline an offer', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id, { isListed: true, status: 'vacant' });

        const offerRes = await request(app).post('/api/offers').set(authHeader(tenant._id))
            .send({ propertyId: property._id.toString(), monthlyRent: 23000, securityDeposit: 46000, leaseDurationMonths: 12 });

        const res = await request(app)
            .put(`/api/offers/${offerRes.body._id}/decline`)
            .set(authHeader(landlord._id));
        expect(res.status).toBe(200);
    });

    it('tenant can withdraw their offer', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id, { isListed: true, status: 'vacant' });

        const offerRes = await request(app).post('/api/offers').set(authHeader(tenant._id))
            .send({ propertyId: property._id.toString(), monthlyRent: 23000, securityDeposit: 46000, leaseDurationMonths: 12 });

        const res = await request(app)
            .delete(`/api/offers/${offerRes.body._id}`)
            .set(authHeader(tenant._id));
        expect(res.status).toBe(200);
    });

    it('GET /api/offers returns tenant\'s own offers', async () => {
        const landlord = await createLandlord();
        const tenantA = await createTenant();
        const tenantB = await createTenant();
        const propA = await createProperty(landlord._id, { isListed: true, status: 'vacant' });
        const propB = await createProperty(landlord._id, { isListed: true, status: 'vacant' });

        await request(app).post('/api/offers').set(authHeader(tenantA._id))
            .send({ propertyId: propA._id.toString(), monthlyRent: 23000, securityDeposit: 46000, leaseDurationMonths: 12 });
        await request(app).post('/api/offers').set(authHeader(tenantB._id))
            .send({ propertyId: propB._id.toString(), monthlyRent: 23000, securityDeposit: 46000, leaseDurationMonths: 12 });

        const res = await request(app).get('/api/offers').set(authHeader(tenantA._id));
        expect(res.status).toBe(200);
    });
});

// ─── BILLING ──────────────────────────────────────────────────────────────────

describe('Billing', () => {
    it('GET /api/billing/plans returns available plans', async () => {
        const res = await request(app).get('/api/billing/plans');
        expect(res.status).toBe(200);
        expect(res.body.plans.length).toBe(3);
    });

    it('GET /api/billing/status returns user subscription info', async () => {
        const landlord = await createLandlord();
        const res = await request(app).get('/api/billing/status').set(authHeader(landlord._id));
        expect(res.status).toBe(200);
        expect(res.body.tier).toBe('free');
    });

    it('returns 401 on billing/status without auth', async () => {
        const res = await request(app).get('/api/billing/status');
        expect(res.status).toBe(401);
    });

    it('POST /api/billing/subscribe returns 400 for invalid tier', async () => {
        const landlord = await createLandlord();
        const res = await request(app)
            .post('/api/billing/subscribe')
            .set(authHeader(landlord._id))
            .send({ tier: 'diamond' });
        expect(res.status).toBe(400);
    });
});