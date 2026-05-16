const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

const User = require('../models/User');
const Property = require('../models/Property');
const Offer = require('../models/Offer');

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.join(__dirname, '..', envFile) });

const LANDLORD_EMAIL = 'sara@rentify.com';
const TENANT_EMAIL = 'ali.khan@testmail.com';

async function run() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/rentifypro';

  try {
    console.log(`Connecting to MongoDB at ${mongoUri}`);
    await mongoose.connect(mongoUri);

    const landlord = await User.findOne({ email: LANDLORD_EMAIL });
    const tenant = await User.findOne({ email: TENANT_EMAIL });

    if (!landlord || !tenant) {
      console.error(`Missing users: Landlord(${!!landlord}), Tenant(${!!tenant})`);
      process.exit(1);
    }

    // Find some of Sara's properties
    const properties = await Property.find({ landlord: landlord._id }).limit(10);
    if (properties.length < 5) {
      console.error(`Sara only has ${properties.length} properties. Run seedSaraProperties.js first.`);
      process.exit(1);
    }

    // Clear existing offers between them to avoid unique index errors
    await Offer.deleteMany({ landlord: landlord._id, tenant: tenant._id });

    const offersToCreate = [
      // 1. Pending Offer (Initial round)
      {
        property: properties[0]._id,
        landlord: landlord._id,
        tenant: tenant._id,
        status: 'pending',
        listedTerms: {
          monthlyRent: properties[0].financials.monthlyRent,
          securityDeposit: properties[0].financials.securityDeposit,
          leaseDurationMonths: properties[0].leaseTerms.defaultDurationMonths || 12
        },
        history: [{
          round: 1,
          offeredBy: 'tenant',
          monthlyRent: Math.floor(properties[0].financials.monthlyRent * 0.95),
          securityDeposit: properties[0].financials.securityDeposit,
          leaseDurationMonths: 12
        }],
        applicantDetails: {
          name: tenant.name,
          email: tenant.email,
          phone: tenant.phone || '0300-1234567'
        }
      },
      // 2. Countered Offer
      {
        property: properties[1]._id,
        landlord: landlord._id,
        tenant: tenant._id,
        status: 'countered',
        listedTerms: {
          monthlyRent: properties[1].financials.monthlyRent,
          securityDeposit: properties[1].financials.securityDeposit,
          leaseDurationMonths: properties[1].leaseTerms.defaultDurationMonths || 12
        },
        history: [
          {
            round: 1,
            offeredBy: 'tenant',
            monthlyRent: Math.floor(properties[1].financials.monthlyRent * 0.9),
            securityDeposit: properties[1].financials.securityDeposit,
            leaseDurationMonths: 12
          },
          {
            round: 2,
            offeredBy: 'landlord',
            monthlyRent: Math.floor(properties[1].financials.monthlyRent * 0.98),
            securityDeposit: properties[1].financials.securityDeposit,
            leaseDurationMonths: 12,
            note: 'I can go slightly lower but not that much. The property is in high demand.'
          }
        ],
        applicantDetails: {
          name: tenant.name,
          email: tenant.email,
          phone: tenant.phone || '0300-1234567'
        }
      },
      // 3. Accepted Offer (Ready for Agreement)
      {
        property: properties[2]._id,
        landlord: landlord._id,
        tenant: tenant._id,
        status: 'accepted',
        listedTerms: {
          monthlyRent: properties[2].financials.monthlyRent,
          securityDeposit: properties[2].financials.securityDeposit,
          leaseDurationMonths: properties[2].leaseTerms.defaultDurationMonths || 12
        },
        history: [{
          round: 1,
          offeredBy: 'tenant',
          monthlyRent: properties[2].financials.monthlyRent,
          securityDeposit: properties[2].financials.securityDeposit,
          leaseDurationMonths: 12
        }],
        applicantDetails: {
          name: tenant.name,
          email: tenant.email,
          phone: tenant.phone || '0300-1234567'
        }
      },
      // 4. Declined Offer
      {
        property: properties[3]._id,
        landlord: landlord._id,
        tenant: tenant._id,
        status: 'declined',
        listedTerms: {
          monthlyRent: properties[3].financials.monthlyRent,
          securityDeposit: properties[3].financials.securityDeposit,
          leaseDurationMonths: properties[3].leaseTerms.defaultDurationMonths || 12
        },
        history: [{
          round: 1,
          offeredBy: 'tenant',
          monthlyRent: Math.floor(properties[3].financials.monthlyRent * 0.7),
          securityDeposit: Math.floor(properties[3].financials.securityDeposit * 0.5),
          leaseDurationMonths: 6
        }],
        applicantDetails: {
          name: tenant.name,
          email: tenant.email,
          phone: tenant.phone || '0300-1234567'
        }
      },
      // 5. Accepted Offer with multiple rounds
      {
        property: properties[4]._id,
        landlord: landlord._id,
        tenant: tenant._id,
        status: 'accepted',
        listedTerms: {
          monthlyRent: properties[4].financials.monthlyRent,
          securityDeposit: properties[4].financials.securityDeposit,
          leaseDurationMonths: properties[4].leaseTerms.defaultDurationMonths || 12
        },
        history: [
          {
            round: 1,
            offeredBy: 'tenant',
            monthlyRent: Math.floor(properties[4].financials.monthlyRent * 0.85),
            securityDeposit: properties[4].financials.securityDeposit,
            leaseDurationMonths: 24
          },
          {
            round: 2,
            offeredBy: 'landlord',
            monthlyRent: Math.floor(properties[4].financials.monthlyRent * 0.95),
            securityDeposit: properties[4].financials.securityDeposit,
            leaseDurationMonths: 24,
            note: 'If you take 24 months, I can do this price.'
          },
          {
            round: 3,
            offeredBy: 'tenant',
            monthlyRent: Math.floor(properties[4].financials.monthlyRent * 0.95),
            securityDeposit: properties[4].financials.securityDeposit,
            leaseDurationMonths: 24
          }
        ],
        applicantDetails: {
          name: tenant.name,
          email: tenant.email,
          phone: tenant.phone || '0300-1234567'
        }
      }
    ];

    const inserted = await Offer.insertMany(offersToCreate);
    console.log(`Successfully seeded ${inserted.length} offers for Sara from Ali Khan.`);

  } catch (error) {
    console.error('Seeding failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('DB connection closed.');
  }
}

run();
