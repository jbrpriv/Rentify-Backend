/**
 * Migration script to fix templates with missing or incorrect baseTheme.
 * Sets baseTheme to the default theme for templates that don't have a proper baseTheme.
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.join(__dirname, '..', envFile) });

const AgreementTemplate = require('../models/AgreementTemplate');
const PdfTheme = require('../models/PdfTheme');

async function fixTemplateThemes() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Fetching default theme...');
    const defaultTheme = await PdfTheme.findOne({ isDefault: true });
    if (!defaultTheme) {
      console.warn('⚠️  No default theme found. Please run seedPdfThemes.js first.');
      await mongoose.connection.close();
      return;
    }
    console.log(`✓ Found default theme: ${defaultTheme.name} (${defaultTheme.themeSlug})`);

    // Find all templates
    console.log('\nFinding all agreement templates...');
    const allTemplates = await AgreementTemplate.find({});
    console.log(`Found ${allTemplates.length} templates`);

    let updated = 0;
    let skipped = 0;

    // Fix templates without baseTheme or with null baseTheme
    for (const template of allTemplates) {
      const currentBaseTheme = template.baseTheme;
      
      if (!currentBaseTheme) {
        console.log(`Updating template "${template.name}" - no baseTheme set`);
        template.baseTheme = defaultTheme._id;
        await template.save();
        updated++;
      } else {
        // Verify the baseTheme exists
        const theme = await PdfTheme.findById(currentBaseTheme);
        if (!theme) {
          console.log(`Fixing template "${template.name}" - baseTheme reference broken`);
          template.baseTheme = defaultTheme._id;
          await template.save();
          updated++;
        } else {
          skipped++;
        }
      }
    }

    console.log(`\n✓ Migration complete!`);
    console.log(`  Updated: ${updated} templates`);
    console.log(`  Verified: ${skipped} templates (already have valid baseTheme)`);

    await mongoose.connection.close();
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

fixTemplateThemes();
