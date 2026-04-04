const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { upload, cloudinary } = require('../config/cloudinary');
const multer = require('multer');
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const { uploadTenantDocument, getTenantDocumentUrl, isS3Configured } = require('../utils/s3Service');

const brandingUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const FAVICON_MAX_SIZE = 2 * 1024 * 1024;

const ensureAdmin = (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ message: 'Admin access required' });
    return false;
  }
  return true;
};

const uploadBrandingAssetToCloudinary = async (file, kind) => {
  const mimeType = String(file?.mimetype || '').toLowerCase();
  if (!mimeType.startsWith('image/')) {
    const err = new Error('Only image files are allowed');
    err.statusCode = 400;
    throw err;
  }

  if (!file?.buffer) {
    const err = new Error('Invalid upload payload');
    err.statusCode = 400;
    throw err;
  }

  if (kind === 'favicon' && file.size > FAVICON_MAX_SIZE) {
    const err = new Error('Favicon image must be under 2MB');
    err.statusCode = 400;
    throw err;
  }

  const dataUri = `data:${mimeType};base64,${file.buffer.toString('base64')}`;
  const uploadOptions = {
    folder: 'rentifypro/branding',
    resource_type: 'image',
  };

  if (kind === 'logo') {
    uploadOptions.transformation = [{ width: 512, height: 512, crop: 'limit', quality: 'auto' }];
  } else {
    uploadOptions.transformation = [{ width: 256, height: 256, crop: 'limit', quality: 'auto' }];
  }

  const result = await cloudinary.uploader.upload(dataUri, uploadOptions);
  return result?.secure_url || result?.url || '';
};

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

// @desc    Get tenant's uploaded documents
// @route   GET /api/upload/tenant-documents
// @access  Private (Tenant)
router.get('/tenant-documents', protect, async (req, res) => {
  try {
    if (req.user.role !== 'tenant') {
      return res.status(403).json({ message: 'Only tenants can access personal documents' });
    }
    const User = require('../models/User');
    const user = await User.findById(req.user._id).select('documents');

    let docs = user.documents || [];
    if (isS3Configured()) {
      docs = await Promise.all(docs.map(async (doc) => {
        if (doc.url && !doc.url.startsWith('http')) {
          const signedUrl = await getTenantDocumentUrl(doc.url);
          return { ...doc.toObject(), url: signedUrl, s3Key: doc.url };
        }
        return doc;
      }));
    }
    res.json({ documents: docs });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete a tenant document
// @route   DELETE /api/upload/tenant-documents/:index
// @access  Private (Tenant)
router.delete('/tenant-documents/:index', protect, async (req, res) => {
  try {
    if (req.user.role !== 'tenant') {
      return res.status(403).json({ message: 'Only tenants can delete personal documents' });
    }
    const User = require('../models/User');
    const user = await User.findById(req.user._id).select('documents');
    const idx = parseInt(req.params.index);
    if (isNaN(idx) || idx < 0 || idx >= user.documents.length) {
      return res.status(400).json({ message: 'Invalid document index' });
    }
    user.documents.splice(idx, 1);
    await user.save();
    res.json({ message: 'Document deleted', documents: user.documents });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Upload tenant documents (ID, income proof, references, etc.)
// @route   POST /api/upload/tenant-documents
// @access  Private (Tenant)
// Supports: PDF, images (JPEG, PNG, WEBP). Max 5 files, 10MB each.
router.post('/tenant-documents', protect, memoryUpload.array('documents', 5), async (req, res) => {
  try {
    if (req.user.role !== 'tenant') {
      return res.status(403).json({ message: 'Only tenants can upload personal documents' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    if (!isS3Configured()) {
      return res.status(503).json({ message: 'S3 Vault not configured on this server' });
    }

    const { documentType = 'general' } = req.body;
    const validTypes = ['id_card', 'income_proof', 'reference_letter', 'bank_statement', 'general'];
    if (!validTypes.includes(documentType)) {
      return res.status(400).json({
        message: `Invalid document type. Valid types: ${validTypes.join(', ')}`,
      });
    }

    const uploaded = await Promise.all(req.files.map(async (file) => {
      const s3Key = await uploadTenantDocument(file.buffer, req.user._id.toString(), file.originalname, file.mimetype);
      return {
        url: s3Key,
        documentType,
        originalName: file.originalname,
        uploadedAt: new Date().toISOString(),
      };
    }));

    // Persist to User document vault
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user._id, {
      $push: { documents: { $each: uploaded } },
    });

    res.status(201).json({
      message: `${uploaded.length} document(s) securely uploaded to S3 vault`,
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

// @desc    Upload global branding logo image
// @route   POST /api/upload/branding/logo
// @access  Private (Admin)
router.post('/branding/logo', protect, brandingUpload.single('image'), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    if (!req.file) {
      return res.status(400).json({ message: 'No image file uploaded' });
    }

    const url = await uploadBrandingAssetToCloudinary(req.file, 'logo');
    if (!url) {
      return res.status(500).json({ message: 'Failed to upload branding logo' });
    }

    return res.json({ url, message: 'Branding logo uploaded' });
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ message: error.message || 'Failed to upload branding logo' });
  }
});

// @desc    Upload global branding favicon image
// @route   POST /api/upload/branding/favicon
// @access  Private (Admin)
router.post('/branding/favicon', protect, brandingUpload.single('image'), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    if (!req.file) {
      return res.status(400).json({ message: 'No image file uploaded' });
    }

    const url = await uploadBrandingAssetToCloudinary(req.file, 'favicon');
    if (!url) {
      return res.status(500).json({ message: 'Failed to upload favicon image' });
    }

    return res.json({ url, message: 'Favicon image uploaded' });
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ message: error.message || 'Failed to upload favicon image' });
  }
});

// @desc    Get a specific tenant's documents (landlord view — view URL only, no raw file served)
// @route   GET /api/upload/landlord/tenant-documents/:tenantId
// @access  Private (Landlord or Admin) — returns short-lived signed view URLs
// Note: We intentionally return view-only URLs (Content-Disposition: inline).
// The frontend SecureDocViewer displays files in an iframe that disables the
// browser download toolbar, making unauthorised saving significantly harder.
router.get('/landlord/tenant-documents/:tenantId', protect, async (req, res) => {
  try {
    if (!['landlord', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only landlords and admins can access tenant documents' });
    }

    const User = require('../models/User');
    const Agreement = require('../models/Agreement');

    // Verify the requesting landlord has (or had) an agreement with this tenant
    if (req.user.role === 'landlord') {
      const agreement = await Agreement.findOne({
        landlord: req.user._id,
        tenant: req.params.tenantId,
      });
      if (!agreement) {
        return res.status(403).json({ message: 'No agreement found with this tenant' });
      }
    }

    const tenant = await User.findById(req.params.tenantId).select('name documents');
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

    let docs = tenant.documents || [];

    if (isS3Configured()) {
      // Return short-lived (10-minute) view-only signed URLs
      docs = await Promise.all(docs.map(async (doc) => {
        if (doc.url && !doc.url.startsWith('http')) {
          const signedUrl = await getTenantDocumentUrl(doc.url, 600);
          return { ...doc.toObject(), url: signedUrl };
        }
        return { ...doc.toObject() };
      }));
    } else {
      // S3 not configured — strip raw URLs to avoid exposing local paths
      docs = docs.map(doc => ({
        _id: doc._id,
        documentType: doc.documentType,
        originalName: doc.originalName,
        uploadedAt: doc.uploadedAt,
        url: null,
      }));
    }

    res.json({
      tenantName: tenant.name,
      documents: docs,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Upload verification documents (landlord / property_manager → S3)
// @route   POST /api/upload/verification-documents
// @access  Private (landlord, property_manager)
router.post('/verification-documents', protect, memoryUpload.array('documents', 5), async (req, res) => {
  try {
    if (!['landlord', 'property_manager'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only landlords and property managers can submit verification documents' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }
    if (!isS3Configured()) {
      return res.status(503).json({ message: 'S3 Vault not configured on this server' });
    }

    const { documentType = 'cnic' } = req.body;

    const uploaded = await Promise.all(req.files.map(async (file) => {
      const s3Key = await uploadTenantDocument(file.buffer, req.user._id.toString(), file.originalname, file.mimetype);
      return {
        url: s3Key,
        documentType,
        originalName: file.originalname,
        uploadedAt: new Date().toISOString(),
      };
    }));

    // Save to user's verificationDocuments and set status to pending
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user._id, {
      verificationDocuments: uploaded,
      verificationStatus: 'pending',
      documentsVerified: false,
    });

    res.status(201).json({
      message: `${uploaded.length} document(s) uploaded. Pending admin review.`,
      documents: uploaded,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;