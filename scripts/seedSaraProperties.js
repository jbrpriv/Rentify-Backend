const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

const User = require('../models/User');
const Property = require('../models/Property');

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.join(__dirname, '..', envFile) });

const TARGET_EMAIL = 'sara@rentify.com';
const TITLE_PREFIX = 'Sara Seed Property';

const cities = [
  { city: 'Karachi', state: 'Sindh', zips: ['74000', '74200', '75500'] },
  { city: 'Lahore', state: 'Punjab', zips: ['54000', '54770', '54810'] },
  { city: 'Islamabad', state: 'Islamabad', zips: ['44000', '44220', '44300'] },
  { city: 'Rawalpindi', state: 'Punjab', zips: ['46000', '46220', '46300'] },
  { city: 'Faisalabad', state: 'Punjab', zips: ['38000', '38220', '38350'] },
];

const streets = [
  'Main Boulevard',
  'Canal Road',
  'Park Avenue',
  'Mall Road',
  'Jinnah Avenue',
  'Garden Street',
  'Lake View Road',
  'Business District Road',
];

const amenitiesPool = [
  'parking',
  'security',
  'elevator',
  'gym',
  'backup_power',
  'wifi_ready',
  'near_metro',
  'family_friendly',
];

const typeConfig = [
  { type: 'apartment', beds: [1, 2, 3], baths: [1, 2], sizeRange: [550, 1450], rentRange: [38000, 125000] },
  { type: 'house', beds: [3, 4, 5], baths: [3, 4], sizeRange: [1800, 4200], rentRange: [120000, 320000] },
  { type: 'studio', beds: [0, 1], baths: [1], sizeRange: [350, 700], rentRange: [28000, 65000] },
  { type: 'commercial', beds: [0], baths: [1, 2], sizeRange: [700, 2600], rentRange: [80000, 260000] },
];

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];

function pickAmenities() {
  const count = rand(3, 5);
  const selected = new Set();
  while (selected.size < count) selected.add(pick(amenitiesPool));
  return Array.from(selected);
}

function makeProperty(index, landlordId) {
  const cityEntry = pick(cities);
  const config = pick(typeConfig);
  const bedrooms = pick(config.beds);
  const bathrooms = pick(config.baths);
  const sizeSqFt = rand(config.sizeRange[0], config.sizeRange[1]);
  const monthlyRent = rand(config.rentRange[0], config.rentRange[1]);
  const securityDeposit = monthlyRent * rand(1, 2);
  const maintenanceFee = rand(0, Math.max(5000, Math.floor(monthlyRent * 0.1)));
  const lateFeeAmount = rand(0, Math.max(1500, Math.floor(monthlyRent * 0.05)));

  const titleType = config.type[0].toUpperCase() + config.type.slice(1);

  return {
    landlord: landlordId,
    title: `${TITLE_PREFIX} ${index + 1} - ${titleType} in ${cityEntry.city}`,
    address: {
      street: `${rand(10, 999)} ${pick(streets)}`,
      unitNumber: config.type === 'house' ? '' : `Unit ${rand(1, 40)}`,
      city: cityEntry.city,
      state: cityEntry.state,
      zip: pick(cityEntry.zips),
      country: 'Pakistan',
    },
    type: config.type,
    specs: {
      bedrooms,
      bathrooms,
      sizeSqFt,
    },
    amenities: pickAmenities(),
    financials: {
      monthlyRent,
      securityDeposit,
      maintenanceFee,
      lateFeeAmount,
      lateFeeGracePeriodDays: 5,
      taxId: '',
    },
    leaseTerms: {
      defaultDurationMonths: pick([6, 12, 18]),
    },
    status: 'vacant',
    isListed: true,
    listingDescription: `Seeded listing ${index + 1} for ${TARGET_EMAIL}`,
    images: [],
  };
}

async function run() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/rentifypro';

  try {
    console.log(`Connecting to MongoDB at ${mongoUri}`);
    await mongoose.connect(mongoUri);

    const user = await User.findOne({ email: TARGET_EMAIL }).select('_id role name email');
    if (!user) {
      console.error(`User not found: ${TARGET_EMAIL}`);
      process.exitCode = 1;
      return;
    }

    if (user.role !== 'landlord') {
      console.error(`User ${TARGET_EMAIL} exists but role is '${user.role}'. Expected 'landlord'.`);
      process.exitCode = 1;
      return;
    }

    await Property.deleteMany({
      landlord: user._id,
      title: { $regex: `^${TITLE_PREFIX}` },
    });

    const docs = Array.from({ length: 25 }, (_, i) => makeProperty(i, user._id));
    const inserted = await Property.insertMany(docs);

    console.log(`Seeded ${inserted.length} properties for ${TARGET_EMAIL}`);
  } catch (error) {
    console.error('Failed to seed Sara properties:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed.');
  }
}

run();
