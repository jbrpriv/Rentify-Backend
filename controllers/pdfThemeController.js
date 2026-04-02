const PdfTheme = require('../models/PdfTheme');

// @desc    Get all active PDF themes
// @route   GET /api/pdf-themes
// @access  Private
const getPdfThemes = async (req, res) => {
  try {
    const themes = await PdfTheme.find().sort({ name: 1 });
    res.json(themes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching themes' });
  }
};

module.exports = {
  getPdfThemes,
};
