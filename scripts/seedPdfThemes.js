const mongoose = require('mongoose');
const dotenv = require('dotenv');
const PdfTheme = require('../models/PdfTheme');

const path = require('path');

// Determine env file based on environment
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.join(__dirname, '..', envFile) });

const themes = [
  {
    name: 'Modern Blue',
    primaryColor: '#0F2B5B', // C.navy
    accentColor: '#1A56DB',  // C.blue
    backgroundColor: '#EBF2FF', // C.lightBlue
    fontFamily: 'Helvetica',
    layoutStyle: 'modern',
    isGlobal: true,
  },
  {
    name: 'Classic Legal',
    primaryColor: '#111827', // Black/dark gray
    accentColor: '#374151',  // Muted gray
    backgroundColor: '#F3F4F6', // Very light gray
    fontFamily: 'Times-Roman',
    layoutStyle: 'classic',
    isGlobal: true,
  },
  {
    name: 'Minimalist Monochrome',
    primaryColor: '#000000', // Pure black
    accentColor: '#000000',  // Pure black
    backgroundColor: '#FFFFFF', // Pure white
    fontFamily: 'Helvetica',
    layoutStyle: 'minimalist',
    isGlobal: true,
  },
];

async function seed() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/rentifypro';
    console.log(`Connecting to MongoDB at ${mongoUri}`);
    await mongoose.connect(mongoUri);

    console.log('Clearing existing global themes...');
    await PdfTheme.deleteMany({ isGlobal: true });

    console.log('Inserting default themes...');
    const createdThemes = await PdfTheme.insertMany(themes);
    
    console.log('Successfully inserted default themes:');
    createdThemes.forEach(t => console.log(` - ${t.name} (layout: ${t.layoutStyle})`));

  } catch (error) {
    console.error('Error seeding themes:', error);
  } finally {
    mongoose.connection.close();
    console.log('Database connection closed.');
  }
}

seed();
