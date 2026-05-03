const mongoose = require('mongoose');
const dotenv = require('dotenv');
const PdfTheme = require('../models/PdfTheme');

const path = require('path');

// Determine env file based on environment
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.join(__dirname, '..', envFile) });

/**
 * Visual themes matching the frontend VISUAL_THEMES registry.
 * Each theme's `themeSlug` must match the frontend `id` exactly.
 */
const themes = [
  // ─── 1. Blank ──────────────────────────────────────────────
  {
    name: 'Blank',
    themeSlug: 'blank',
    description: 'No styling — raw document with system fonts.',
    primaryColor: '#000000',
    accentColor: '#666666',
    backgroundColor: '#FFFFFF',
    pageBackgroundColor: '#FFFFFF',
    headingColor: '#000000',
    bodyTextColor: '#333333',
    fontFamily: 'Helvetica',
    headingFontFamily: '',
    googleFontUrl: '',
    tableBorderColor: '#cccccc',
    tableHeaderBg: '#f5f5f5',
    tableHeaderTextColor: '#000000',
    heroBackground: '',
    heroPattern: '',
    heroHeight: 0,
    logoMaxHeight: '120px',
    logoAlignment: 'left',
    tableRadius: '0px',
    pageTexture: 'none',
    layoutStyle: 'minimalist',
    isGlobal: true,
    isDefault: false,
  },

  // ─── 2. Commercial Classic ─────────────────────────────────
  {
    name: 'Commercial Classic',
    themeSlug: 'commercial-classic',
    description: 'Traditional serif typography with navy & gold accents.',
    primaryColor: '#1B2A4A',
    accentColor: '#C5A55A',
    backgroundColor: '#FAF8F4',
    pageBackgroundColor: '#FAF8F4',
    headingColor: '#1B2A4A',
    bodyTextColor: '#2D3748',
    fontFamily: "'Lora', 'Times New Roman', serif",
    headingFontFamily: "'Playfair Display', Georgia, serif",
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Lora:wght@400;600;700&display=swap',
    tableBorderColor: '#C5A55A',
    tableHeaderBg: '#1B2A4A',
    tableHeaderTextColor: '#FFFFFF',
    heroBackground: '#F2EDE3',
    heroPattern: 'linear-gradient(180deg, #F2EDE3 0%, #FAF8F4 100%)',
    heroHeight: 320,
    logoMaxHeight: '100px',
    logoAlignment: 'center',
    tableRadius: '0px',
    pageTexture: 'none',
    headerRule: '3px double #C5A55A',
    sectionRule: '1px solid #E2D9C8',
    layoutStyle: 'classic',
    isGlobal: true,
    isDefault: false,
  },

  // ─── 3. Modern Minimalist ──────────────────────────────────
  {
    name: 'Modern Minimalist',
    themeSlug: 'modern-minimalist',
    description: 'Clean sans-serif with generous whitespace and soft blue accents.',
    primaryColor: '#1E293B',
    accentColor: '#3B82F6',
    backgroundColor: '#FFFFFF',
    pageBackgroundColor: '#FFFFFF',
    headingColor: '#0F172A',
    bodyTextColor: '#475569',
    fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    headingFontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
    tableBorderColor: '#E2E8F0',
    tableHeaderBg: '#F8FAFC',
    tableHeaderTextColor: '#1E293B',
    heroBackground: 'transparent',
    heroPattern: 'none',
    heroHeight: 40,
    logoMaxHeight: '80px',
    logoAlignment: 'left',
    tableRadius: '12px',
    pageTexture: 'none',
    headerRule: 'none',
    sectionRule: '1px solid #F1F5F9',
    layoutStyle: 'modern',
    isGlobal: true,
    isDefault: true,
  },

  // ─── 4. Professional Legal ─────────────────────────────────
  {
    name: 'Professional Legal',
    themeSlug: 'professional-legal',
    description: 'Formal serif with dark slate & burgundy — built for legal documents.',
    primaryColor: '#1A1A2E',
    accentColor: '#7B2D3B',
    backgroundColor: '#FDFCFA',
    pageBackgroundColor: '#FDFCFA',
    headingColor: '#1A1A2E',
    bodyTextColor: '#374151',
    fontFamily: "'Source Sans 3', 'Segoe UI', Roboto, sans-serif",
    headingFontFamily: "'Merriweather', Georgia, serif",
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@700;900&family=Source+Sans+3:wght@400;600;700&display=swap',
    tableBorderColor: '#D1CBC3',
    tableHeaderBg: '#1A1A2E',
    tableHeaderTextColor: '#F5F0EB',
    heroBackground: 'transparent',
    heroPattern: 'none',
    heroHeight: 20,
    logoMaxHeight: '80px',
    logoAlignment: 'left',
    tableRadius: '0px',
    pageTexture: 'repeating-linear-gradient(0deg, transparent, transparent 27px, rgba(0,0,0,0.04) 27px, rgba(0,0,0,0.04) 28px)',
    headerRule: '4px double #8B2635',
    sectionRule: '1px solid #E8E2DA',
    layoutStyle: 'legal',
    isGlobal: true,
    isDefault: false,
  },

  // ─── 5. Executive Premium ──────────────────────────────────
  {
    name: 'Executive Premium',
    themeSlug: 'executive-premium',
    description: 'Luxury feel with deep purple, rose gold, and gradient hero.',
    primaryColor: '#2D1B4E',
    accentColor: '#C4917B',
    backgroundColor: '#FEFCFF',
    pageBackgroundColor: '#FEFCFF',
    headingColor: '#FFFFFF',
    bodyTextColor: '#3C3555',
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    headingFontFamily: "'Outfit', 'Helvetica Neue', sans-serif",
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap',
    tableBorderColor: '#D4C5E0',
    tableHeaderBg: 'linear-gradient(135deg, #2D1B4E 0%, #4A2D6E 100%)',
    tableHeaderTextColor: '#FFFFFF',
    heroBgColor: '#2D1B4E',
    heroBackground: '#2D1B4E',
    heroPattern: 'linear-gradient(135deg, #2D1B4E 0%, #5A3D7E 55%, #8B5CF6 100%)',
    heroHeight: 400,
    logoMaxHeight: '80px',
    logoAlignment: 'center',
    tableRadius: '12px',
    pageTexture: 'none',
    headerRule: 'none',
    sectionRule: '5px solid #D4A574',
    layoutStyle: 'premium',
    isGlobal: true,
    isDefault: false,
  },

  // ─── 6. Fresh Contemporary ─────────────────────────────────
  {
    name: 'Fresh Contemporary',
    themeSlug: 'fresh-contemporary',
    description: 'Vibrant teal & coral with rounded elements and modern energy.',
    primaryColor: '#0F766E',
    accentColor: '#F97066',
    backgroundColor: '#F0FDFA',
    pageBackgroundColor: '#F0FDFA',
    headingColor: '#FFFFFF',
    bodyTextColor: '#334155',
    fontFamily: "'Nunito', 'Segoe UI', sans-serif",
    headingFontFamily: "'Poppins', 'Helvetica Neue', sans-serif",
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800;900&family=Nunito:wght@400;600;700&display=swap',
    tableBorderColor: '#99F6E4',
    tableHeaderBg: '#0F766E',
    tableHeaderTextColor: '#FFFFFF',
    heroBgColor: '#0F766E',
    heroBackground: '#0F766E',
    heroPattern: 'linear-gradient(160deg, #0F766E 0%, #0D9488 100%)',
    heroHeight: 200,
    logoMaxHeight: '70px',
    logoAlignment: 'left',
    tableRadius: '12px',
    pageTexture: 'none',
    headerRule: 'none',
    sectionRule: '3px solid #F97066',
    layoutStyle: 'contemporary',
    isGlobal: true,
    isDefault: false,
  },

  // ─── 7. Elegant Serif ──────────────────────────────────────
  {
    name: 'Elegant Serif',
    themeSlug: 'elegant-serif',
    description: 'A sophisticated theme using Cinzel with a subtle textured paper background.',
    primaryColor: '#111111',
    accentColor: '#B29B72',
    backgroundColor: '#FAF9F6',
    pageBackgroundColor: '#FAF9F6',
    headingColor: '#111111',
    bodyTextColor: '#3D3D3D',
    fontFamily: "'Lora', 'Georgia', serif",
    headingFontFamily: "'Cinzel', 'Playfair Display', serif",
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800;900&family=Lora:wght@400;600;700&display=swap',
    tableBorderColor: '#D8D2C4',
    tableHeaderBg: '#F5F2ED',
    tableHeaderTextColor: '#1A1A1A',
    heroBackground: 'transparent',
    heroPattern: 'none',
    heroHeight: 60,
    logoMaxHeight: '90px',
    logoAlignment: 'center',
    tableRadius: '10px',
    pageTexture: 'radial-gradient(circle, #E0DBD0 1px, transparent 1px)',
    headerRule: 'none',
    sectionRule: '2px dotted #C5B5A5',
    layoutStyle: 'editorial',
    isGlobal: true,
    isDefault: false,
  },

  // ─── 8. Tech Innovator ─────────────────────────────────────
  {
    name: 'Tech Innovator',
    themeSlug: 'tech-innovator',
    description: 'A tech-forward minimalist theme using monospace headers and stark contrast.',
    primaryColor: '#000000',
    accentColor: '#3B82F6',
    backgroundColor: '#FFFFFF',
    pageBackgroundColor: '#FFFFFF',
    headingColor: '#FFFFFF',
    bodyTextColor: '#1F2937',
    fontFamily: "'Roboto', 'Helvetica Neue', sans-serif",
    headingFontFamily: "'Space Grotesk', 'Courier New', monospace",
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700;800;900&family=Roboto:wght@400;500;700&display=swap',
    tableBorderColor: '#E5E5E5',
    tableHeaderBg: '#0A0A0A',
    tableHeaderTextColor: '#FFFFFF',
    heroBgColor: '#0A0A0A',
    heroBackground: '#0A0A0A',
    heroPattern: 'none',
    heroHeight: 160,
    logoMaxHeight: '70px',
    logoAlignment: 'left',
    tableRadius: '0px',
    pageTexture: 'repeating-linear-gradient(90deg, transparent, transparent 119px, rgba(37,99,235,0.04) 119px, rgba(37,99,235,0.04) 120px)',
    headerRule: 'none',
    sectionRule: '3px solid #2563EB',
    layoutStyle: 'ledger',
    isGlobal: true,
    isDefault: false,
  },
];

async function seed() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/rentifypro';
    console.log(`Connecting to MongoDB at ${mongoUri}`);
    await mongoose.connect(mongoUri);

    console.log('Clearing existing global themes...');
    await PdfTheme.deleteMany({ isGlobal: true });

    console.log('Inserting visual themes...');
    const createdThemes = await PdfTheme.insertMany(themes);
    
    console.log('Successfully inserted visual themes:');
    createdThemes.forEach(t => console.log(` - ${t.name} [${t.themeSlug}] (layout: ${t.layoutStyle})`));

  } catch (error) {
    console.error('Error seeding themes:', error);
  } finally {
    mongoose.connection.close();
    console.log('Database connection closed.');
  }
}

seed();