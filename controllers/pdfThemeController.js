const PdfTheme = require('../models/PdfTheme');
const logger = require('../utils/logger');

// @desc    Get all global PDF themes
// @route   GET /api/pdf-themes
// @access  Private
const getPdfThemes = async (req, res) => {
  try {
    const themes = await PdfTheme.find().sort({ name: 1 });
    res.json(themes);
  } catch (err) {
    logger.error('getPdfThemes error', { message: err.message });
    res.status(500).json({ message: 'Server error fetching themes' });
  }
};

// @desc    Set a theme as the global default (admin only)
// @route   PUT /api/pdf-themes/:id/set-default
// @access  Private (Admin)
const setDefaultTheme = async (req, res) => {
  try {
    const theme = await PdfTheme.findById(req.params.id);
    if (!theme) return res.status(404).json({ message: 'Theme not found' });

    // Un-default all others first
    await PdfTheme.updateMany({ isDefault: true }, { isDefault: false });

    theme.isDefault = true;
    await theme.save();

    res.json({ message: `"${theme.name}" is now the global default PDF theme.`, theme });
  } catch (err) {
    logger.error('setDefaultTheme error', { message: err.message });
    res.status(500).json({ message: 'Server error updating default theme' });
  }
};

module.exports = {
  getPdfThemes,
  setDefaultTheme,
};
