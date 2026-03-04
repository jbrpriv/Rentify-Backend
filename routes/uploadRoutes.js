const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { upload, cloudinary } = require('../config/cloudinary');

// @desc    Upload up to 5 property images
// @route   POST /api/upload/property-images
// @access  Private
router.post('/property-images', protect, upload.array('images', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const urls = req.files.map((file) => file.path);
    res.json({ urls });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete an image from Cloudinary
// @route   DELETE /api/upload/property-images
// @access  Private
router.delete('/property-images', protect, async (req, res) => {
  try {
    const { imageUrl } = req.body;

    // Extract public_id from URL
    const parts = imageUrl.split('/');
    const filename = parts[parts.length - 1].split('.')[0];
    const publicId = `rentifypro/properties/${filename}`;

    await cloudinary.uploader.destroy(publicId);
    res.json({ message: 'Image deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Upload tenant documents (ID, income proof, references, etc.)
// @route   POST /api/upload/tenant-documents
// @access  Private (Tenant)
// Supports: PDF, images (JPEG, PNG, WEBP). Max 5 files, 10MB each.
router.post('/tenant-documents', protect, upload.array('documents', 5), async (req, res) => {
  try {
    if (req.user.role !== 'tenant') {
      return res.status(403).json({ message: 'Only tenants can upload personal documents' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const { documentType = 'general' } = req.body;
    const validTypes = ['id_card', 'income_proof', 'reference_letter', 'bank_statement', 'general'];
    if (!validTypes.includes(documentType)) {
      return res.status(400).json({
        message: `Invalid document type. Valid types: ${validTypes.join(', ')}`,
      });
    }

    const uploaded = req.files.map((file) => ({
      url:          file.path,
      documentType,
      originalName: file.originalname,
      uploadedAt:   new Date().toISOString(),
    }));

    res.status(201).json({
      message: `${uploaded.length} document(s) uploaded successfully`,
      documents: uploaded,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Upload a single profile photo
// @route   POST /api/upload/profile-photo
// @access  Private
router.post('/profile-photo', protect, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user._id, { profilePhoto: req.file.path });

    res.json({ url: req.file.path, message: 'Profile photo updated' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;