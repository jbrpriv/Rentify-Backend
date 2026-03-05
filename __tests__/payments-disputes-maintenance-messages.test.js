const request = require('supertest');
const { createLandlord, createTenant, createAdmin, createProperty, createAgreement, authHeader } = require('./helpers');
const Agreement = require('../models/Agreement');

jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('../utils/smsService', () => ({ sendOTP: jest.fn(), verifyOTP: jest.fn(), sendSMS: jest.fn() }));
jest.mock('../utils/firebaseService', () => ({ sendPushNotification: jest.fn() }));
jest.mock('../utils/pdfGenerator', () => ({
    generateAgreementPDF: jest.fn((a, l, t, p, res) => res.end()),
    generateAgreementPDFBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
    generateReceiptPDFBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-receipt')),
}));
jest.mock('../utils/s3Service', () => ({
    isS3Configured: jest.fn().mockReturnValue(false),
    uploadAgreementPDF: jest.fn(),
    uploadReceiptPDF: jest.fn(),
    getAgreementPDFUrl: jest.fn(),
}));
jest.mock('../config/redis', () => ({ redisConnection: {}, redisClient: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('stripe', () => () => ({
    checkout: {
        sessions: {
            create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test', id: 'cs_test_123' }),
            list: jest.fn().mockResolvedValue({ data: [] }),
        },
    },
    webhooks: {
        constructEvent: jest.fn().mockReturnValue({ type: 'test', data: { object: {} } }),
    },
    customers: {
        create: jest.fn().mockResolvedValue({ id: 'cus_test123' }),
        retrieve: jest.fn().mockResolvedValue({ metadata: { userId: null } }),
    },
    billingPortal: {
        sessions: { create: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/test' }) },
    },
}));

let app;
beforeAll(() => { app = require('../server').app; });

// ─── PAYMENTS ─────────────────────────────────────────────────────────────────

describe('POST /api/payments/create-checkout-session', () => {
    it('tenant can create checkout for a signed agreement', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, {
            status: 'signed',
            signatures: {
                landlord: { signed: true, signedAt: new Date() },
                tenant: { signed: true, signedAt: new Date() },
            },
        });

        const res = await request(app)
            .post('/api/payments/create-checkout-session')
            .set(authHeader(tenant._id))
            .send({ agreementId: agreement._id.toString() });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('url');
    });

    it('returns 403 if a different tenant tries to pay', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const otherTenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, {
            status: 'signed',
        });

        const res = await request(app)
            .post('/api/payments/create-checkout-session')
            .set(authHeader(otherTenant._id))
            .send({ agreementId: agreement._id.toString() });
        expect(res.status).toBe(403);
    });

    it('returns 400 if agreement is not yet signed', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, {
            status: 'draft',
        });

        const res = await request(app)
            .post('/api/payments/create-checkout-session')
            .set(authHeader(tenant._id))
            .send({ agreementId: agreement._id.toString() });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/signed/i);
    });

    it('returns 400 if already paid', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, {
            status: 'signed',
            isPaid: true,
        });

        const res = await request(app)
            .post('/api/payments/create-checkout-session')
            .set(authHeader(tenant._id))
            .send({ agreementId: agreement._id.toString() });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already been made/i);
    });
});

describe('GET /api/payments/schedule/:agreementId', () => {
    it('landlord can view rent schedule for their agreement', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, {
            status: 'active',
            isPaid: true,
            rentSchedule: [
                { dueDate: new Date(), amount: 25000, status: 'paid', paidDate: new Date(), paidAmount: 25000 },
            ],
        });

        const res = await request(app)
            .get(`/api/payments/schedule/${agreement._id}`)
            .set(authHeader(landlord._id));
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('schedule');
        expect(res.body).toHaveProperty('summary');
    });

    it('unrelated user cannot view rent schedule', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const stranger = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id);

        const res = await request(app)
            .get(`/api/payments/schedule/${agreement._id}`)
            .set(authHeader(stranger._id));
        expect(res.status).toBe(403);
    });
});

// ─── DISPUTES ─────────────────────────────────────────────────────────────────

describe('Disputes', () => {
    it('tenant can file a dispute on their active agreement', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, { status: 'active' });

        const res = await request(app)
            .post('/api/disputes')
            .set(authHeader(tenant._id))
            .send({
                agreementId: agreement._id.toString(),
                title: 'Landlord not fixing AC',
                description: 'The AC has been broken for 3 weeks and landlord is not responding.',
                category: 'maintenance',
            });
        console.log(res.body);
        expect(res.status).toBe(201);
        expect(res.body.filedBy._id).toBe(tenant._id.toString());
    });

    it('landlord can file a dispute too', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, { status: 'active' });

        const res = await request(app)
            .post('/api/disputes')
            .set(authHeader(landlord._id))
            .send({
                agreementId: agreement._id.toString(),
                title: 'Tenant damaged property',
                description: 'Significant damage to the walls.',
                category: 'damage',
            });
        expect(res.status).toBe(201);
    });

    it('unrelated user cannot file a dispute', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const stranger = await createTenant();
        const property = await createProperty(landlord._id);
        const agreement = await createAgreement(landlord._id, tenant._id, property._id, { status: 'active' });

        const res = await request(app)
            .post('/api/disputes')
            .set(authHeader(stranger._id))
            .send({
                agreementId: agreement._id.toString(),
                title: 'I have no business here',
                description: 'Stranger filing dispute.',
            });
        expect(res.status).toBe(403);
    });

    it('GET /api/disputes returns only disputes relevant to the user', async () => {
        const landlord = await createLandlord();
        const tenantA = await createTenant();
        const tenantB = await createTenant();
        const propA = await createProperty(landlord._id);
        const propB = await createProperty(landlord._id);
        const agA = await createAgreement(landlord._id, tenantA._id, propA._id, { status: 'active' });
        const agB = await createAgreement(landlord._id, tenantB._id, propB._id, { status: 'active' });

        await request(app).post('/api/disputes').set(authHeader(tenantA._id))
            .send({ agreementId: agA._id.toString(), title: 'A dispute', description: 'Test A' });
        await request(app).post('/api/disputes').set(authHeader(tenantB._id))
            .send({ agreementId: agB._id.toString(), title: 'B dispute', description: 'Test B' });

        const res = await request(app).get('/api/disputes').set(authHeader(tenantA._id));
        expect(res.status).toBe(200);
        expect(res.body.disputes.every(d =>
            d.filedBy._id === tenantA._id.toString() ||
            d.against._id === tenantA._id.toString()
        )).toBe(true);
    });
});

// ─── MAINTENANCE ──────────────────────────────────────────────────────────────

describe('Maintenance Requests', () => {
    let landlord, tenant, property, agreement;

    beforeEach(async () => {
        landlord = await createLandlord();
        tenant = await createTenant();
        property = await createProperty(landlord._id);
        agreement = await createAgreement(landlord._id, tenant._id, property._id, { status: 'active' });
    });

    it('tenant with active lease can submit a maintenance request', async () => {
        const res = await request(app)
            .post('/api/maintenance')
            .set(authHeader(tenant._id))
            .send({
                propertyId: property._id.toString(),
                title: 'Broken pipe',
                description: 'The kitchen pipe is leaking.',
                priority: 'urgent',
                category: 'plumbing',
            });
        console.log(res.body);
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('open');
        expect(res.body.tenant._id).toBe(tenant._id.toString());
    });

    it('tenant without active lease cannot submit maintenance request', async () => {
        const unrelatedTenant = await createTenant();
        const res = await request(app)
            .post('/api/maintenance')
            .set(authHeader(unrelatedTenant._id))
            .send({
                propertyId: property._id.toString(),
                title: 'Random request',
                description: 'Should be rejected.',
                priority: 'low',
            });
        expect(res.status).toBe(403);
    });

    it('landlord can update maintenance request status', async () => {
        const createRes = await request(app)
            .post('/api/maintenance')
            .set(authHeader(tenant._id))
            .send({
                propertyId: property._id.toString(),
                title: 'AC not working',
                description: 'Needs repair.',
                priority: 'medium',
            });

        const requestId = createRes.body._id;
        const updateRes = await request(app)
            .put(`/api/maintenance/${requestId}`)
            .set(authHeader(landlord._id))
            .send({ status: 'in_progress', note: 'Technician dispatched' });
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.status).toBe('in_progress');
    });

    it('GET /api/maintenance returns only tenant\'s own requests', async () => {
        const otherTenant = await createTenant();
        const otherProp = await createProperty(landlord._id);
        await createAgreement(landlord._id, otherTenant._id, otherProp._id, { status: 'active' });

        await request(app).post('/api/maintenance').set(authHeader(tenant._id))
            .send({ propertyId: property._id.toString(), title: 'My request', description: 'Test', priority: 'low' });
        await request(app).post('/api/maintenance').set(authHeader(otherTenant._id))
            .send({ propertyId: otherProp._id.toString(), title: 'Other request', description: 'Test', priority: 'low' });

        const res = await request(app).get('/api/maintenance').set(authHeader(tenant._id));
        expect(res.status).toBe(200);
        expect(res.body.requests.every(r => r.tenant._id === tenant._id.toString())).toBe(true);
    });
});

// ─── MESSAGES ─────────────────────────────────────────────────────────────────

describe('Messages', () => {
    it('user can send a message to another user', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);

        const res = await request(app)
            .post('/api/messages')
            .set(authHeader(tenant._id))
            .send({
                propertyId: property._id.toString(),
                receiverId: landlord._id.toString(),
                content: 'Hello, I have a question about the lease.',
            });
        expect(res.status).toBe(201);
        expect(res.body.content).toBe('Hello, I have a question about the lease.');
        expect(res.body.sender._id).toBe(tenant._id.toString());
    });

    it('returns 400 for empty message content', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);

        const res = await request(app)
            .post('/api/messages')
            .set(authHeader(tenant._id))
            .send({ propertyId: property._id.toString(), receiverId: landlord._id.toString(), content: '   ' });
        expect(res.status).toBe(400);
    });

    it('GET /api/messages returns inbox for current user', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);

        await request(app).post('/api/messages').set(authHeader(tenant._id))
            .send({ propertyId: property._id.toString(), receiverId: landlord._id.toString(), content: 'Msg 1' });

        const res = await request(app).get('/api/messages').set(authHeader(landlord._id));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/messages/unread-count returns a count', async () => {
        const landlord = await createLandlord();
        const tenant = await createTenant();
        const property = await createProperty(landlord._id);

        await request(app).post('/api/messages').set(authHeader(tenant._id))
            .send({ propertyId: property._id.toString(), receiverId: landlord._id.toString(), content: 'Unread msg' });

        const res = await request(app)
            .get('/api/messages/unread-count')
            .set(authHeader(landlord._id));
        expect(res.status).toBe(200);
        expect(res.body.unreadCount).toBe(1);
    });
});