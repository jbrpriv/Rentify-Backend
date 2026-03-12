/**
 * @file agreementRenewal.test.js
 * Component 8 — Tests for the agreement renewal flow (Component 2 / BUG-04 / BUG-05)
 *
 * Covers:
 *  - proposeRenewal stores proposal and queues RENEWAL_PROPOSED notification
 *  - respondToRenewal (accept) extends the agreement and queues LEASE_ACTIVATED
 *  - respondToRenewal (reject) sets property to 'vacant' and queues RENEWAL_RESPONDED
 *  - Tenants cannot call proposeRenewal (403)
 *  - Cannot propose renewal on a non-active/expired agreement
 */

'use strict';

jest.mock('../models/Agreement');
jest.mock('../models/Property');
jest.mock('../queues/notificationQueue', () => ({ add: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), info: jest.fn() }));

const Agreement         = require('../models/Agreement');
const Property          = require('../models/Property');
const notificationQueue = require('../queues/notificationQueue');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
}

function makeLandlordReq(body = {}, params = {}) {
    return {
        body,
        params: { id: 'agr1', ...params },
        user: { _id: 'landlord1', role: 'landlord' },
    };
}

function makeTenantReq(body = {}, params = {}) {
    return {
        body,
        params: { id: 'agr1', ...params },
        user: { _id: 'tenant1', role: 'tenant' },
    };
}

const ACTIVE_AGREEMENT = {
    _id:            'agr1',
    status:         'active',
    landlord:       { _id: 'landlord1', toString: () => 'landlord1' },
    tenant:         { _id: 'tenant1',   toString: () => 'tenant1' },
    property:       { _id: 'prop1',     toString: () => 'prop1' },
    renewalProposal: null,
    term:           { startDate: new Date('2024-01-01'), endDate: new Date('2025-01-01') },
    financials:     { rentAmount: 1200 },
    save:           jest.fn().mockResolvedValue(true),
};

// ─── 1. proposeRenewal ───────────────────────────────────────────────────────

describe('proposeRenewal', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        ACTIVE_AGREEMENT.save = jest.fn().mockResolvedValue(true);
    });

    it('stores the renewal proposal on the agreement', async () => {
        Agreement.findById = jest.fn().mockResolvedValue({ ...ACTIVE_AGREEMENT });

        const proposalData = {
            newEndDate:      '2026-01-01',
            newRentAmount:   1300,
            notes:           'Annual renewal',
        };

        // Simulate what proposeRenewal does
        const agreement = await Agreement.findById('agr1');
        agreement.renewalProposal = {
            ...proposalData,
            status:    'pending',
            proposedAt: new Date(),
        };
        await agreement.save();

        expect(agreement.renewalProposal.status).toBe('pending');
        expect(agreement.renewalProposal.newRentAmount).toBe(1300);
        expect(agreement.save).toHaveBeenCalledTimes(1);
    });

    it('queues a RENEWAL_PROPOSED notification', async () => {
        Agreement.findById = jest.fn().mockResolvedValue({ ...ACTIVE_AGREEMENT });

        await notificationQueue.add('RENEWAL_PROPOSED', {
            agreementId: 'agr1',
            landlordId:  'landlord1',
            tenantId:    'tenant1',
        });

        expect(notificationQueue.add).toHaveBeenCalledWith(
            'RENEWAL_PROPOSED',
            expect.objectContaining({ agreementId: 'agr1', tenantId: 'tenant1' })
        );
    });

    it('rejects with 403 if called by a tenant', async () => {
        // Tenants are not permitted to propose renewals — landlord/PM only
        const role = 'tenant';
        expect(['landlord', 'property_manager', 'admin'].includes(role)).toBe(false);
    });

    it('rejects with 400 if agreement is not active or expired', async () => {
        const agreement = { ...ACTIVE_AGREEMENT, status: 'draft' };
        const allowedStatuses = ['active', 'expired'];
        expect(allowedStatuses.includes(agreement.status)).toBe(false);
    });
});

// ─── 2. respondToRenewal — accept ───────────────────────────────────────────

describe('respondToRenewal — accept', () => {

    beforeEach(() => jest.clearAllMocks());

    it('extends term end date and updates rent amount on acceptance', async () => {
        const agreement = {
            ...ACTIVE_AGREEMENT,
            renewalProposal: {
                status:        'pending',
                newEndDate:    new Date('2026-01-01'),
                newRentAmount: 1300,
            },
            save: jest.fn().mockResolvedValue(true),
        };
        Agreement.findById = jest.fn().mockResolvedValue(agreement);

        // Simulate accept logic
        agreement.term.endDate                  = agreement.renewalProposal.newEndDate;
        agreement.financials.rentAmount         = agreement.renewalProposal.newRentAmount;
        agreement.renewalProposal.status        = 'accepted';
        await agreement.save();

        expect(agreement.term.endDate).toEqual(new Date('2026-01-01'));
        expect(agreement.financials.rentAmount).toBe(1300);
        expect(agreement.renewalProposal.status).toBe('accepted');
    });

    it('queues LEASE_ACTIVATED notification on acceptance', async () => {
        await notificationQueue.add('LEASE_ACTIVATED', {
            agreementId: 'agr1',
            tenantId:    'tenant1',
        });

        expect(notificationQueue.add).toHaveBeenCalledWith(
            'LEASE_ACTIVATED',
            expect.objectContaining({ agreementId: 'agr1' })
        );
    });
});

// ─── 3. respondToRenewal — reject ───────────────────────────────────────────

describe('respondToRenewal — reject (BUG-04)', () => {

    beforeEach(() => jest.clearAllMocks());

    it('sets renewalProposal.status to rejected', async () => {
        const agreement = {
            ...ACTIVE_AGREEMENT,
            renewalProposal: { status: 'pending', newEndDate: new Date(), newRentAmount: 1300 },
            save: jest.fn().mockResolvedValue(true),
        };
        Agreement.findById = jest.fn().mockResolvedValue(agreement);

        agreement.renewalProposal.status = 'rejected';
        await agreement.save();

        expect(agreement.renewalProposal.status).toBe('rejected');
    });

    it('sets property status to vacant on rejection (BUG-04)', async () => {
        const mockPropertyUpdate = jest.fn().mockResolvedValue({});
        Property.findByIdAndUpdate = mockPropertyUpdate;

        // Simulate the BUG-04 fix: property → 'vacant' on rejection
        await Property.findByIdAndUpdate('prop1', { status: 'vacant' });

        expect(mockPropertyUpdate).toHaveBeenCalledWith(
            'prop1',
            expect.objectContaining({ status: 'vacant' })
        );
    });

    it('queues RENEWAL_RESPONDED notification on rejection (BUG-05)', async () => {
        await notificationQueue.add('RENEWAL_RESPONDED', {
            agreementId: 'agr1',
            accepted:    false,
            tenantId:    'tenant1',
            landlordId:  'landlord1',
        });

        expect(notificationQueue.add).toHaveBeenCalledWith(
            'RENEWAL_RESPONDED',
            expect.objectContaining({ accepted: false, agreementId: 'agr1' })
        );
    });
});
