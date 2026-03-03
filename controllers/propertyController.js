const Property = require('../models/Property');
const Offer    = require('../models/Offer');
const { validationResult } = require('express-validator');

// @desc    Create a new property
const createProperty = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });
  try {
    const property = await Property.create({
      landlord:           req.user._id,
      title:              req.body.title,
      type:               req.body.type,
      address:            req.body.address,
      specs:              req.body.specs,
      financials:         req.body.financials,
      leaseTerms:         req.body.leaseTerms,
      amenities:          req.body.amenities || [],
      listingDescription: req.body.listingDescription,
      images:             req.body.images || [],
      isListed:           false,
    });
    res.status(201).json(property);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get properties (role-aware)
const getProperties = async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'landlord')          filter.landlord  = req.user._id;
    else if (req.user.role === 'property_manager') filter.managedBy = req.user._id;

    const properties = await Property.find(filter)
      .populate('landlord', 'name email')
      .populate('managedBy', 'name email')
      .populate('pmInvitation.invitedManager', 'name email')
      .sort('-createdAt');

    res.json(properties);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single property by ID
const getPropertyById = async (req, res) => {
  try {
    const property = await Property.findById(req.params.id)
      .populate('landlord', 'name email')
      .populate('managedBy', 'name email');

    if (!property) return res.status(404).json({ message: 'Property not found' });

    const uid     = req.user._id.toString();
    const isOwner = property.landlord._id.toString() === uid;
    const isPM    = property.managedBy?._id?.toString() === uid;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isPM && !isAdmin) return res.status(403).json({ message: 'Not authorized' });

    res.json(property);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update a property
const updateProperty = async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ message: 'Property not found' });

    const isOwner = property.landlord.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Not authorized' });

    const allowed = ['title','address','type','specs','financials','leaseTerms','amenities','listingDescription','images','status'];
    allowed.forEach(f => { if (req.body[f] !== undefined) property[f] = req.body[f]; });

    await property.save();
    res.json(property);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a property (landlord only, not if occupied)
// @route   DELETE /api/properties/:id
const deleteProperty = async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ message: 'Property not found' });

    const isOwner = property.landlord.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Not authorized to delete this property' });

    if (property.status === 'occupied')
      return res.status(400).json({ message: 'Cannot delete an occupied property. The tenant must vacate first.' });

    // Remove all pending/countered offers for this property too
    await Offer.deleteMany({ property: property._id, status: { $in: ['pending', 'countered'] } });

    await property.deleteOne();
    res.json({ message: 'Property deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── PM Invitation ────────────────────────────────────────────────────────────

const inviteManager = async (req, res) => {
  try {
    const { managerId } = req.body;
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ message: 'Property not found' });

    const isOwner = property.landlord.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') return res.status(403).json({ message: 'Not authorized' });

    const User    = require('../models/User');
    const manager = await User.findById(managerId);
    if (!manager || manager.role !== 'property_manager')
      return res.status(400).json({ message: 'User is not a registered property manager' });

    property.pmInvitation = { invitedManager: managerId, status: 'pending', invitedAt: new Date() };
    await property.save();

    const landlord = await User.findById(req.user._id);
    const { sendEmail } = require('../utils/emailService');
    await sendEmail(manager.email, 'pmInvitation', manager.name, landlord.name, property.title, property._id);

    res.json({ message: 'Invitation sent', property });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const respondToInvitation = async (req, res) => {
  try {
    const { accept } = req.body;
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ message: 'Property not found' });

    if (property.pmInvitation?.invitedManager?.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'This invitation is not for you' });
    if (property.pmInvitation?.status !== 'pending')
      return res.status(400).json({ message: 'No pending invitation' });

    if (accept) {
      property.managedBy            = req.user._id;
      property.pmInvitation.status  = 'accepted';
    } else {
      property.pmInvitation.status  = 'declined';
    }
    await property.save();

    const populated = await Property.findById(property._id)
      .populate('managedBy', 'name email')
      .populate('pmInvitation.invitedManager', 'name email');

    res.json({ message: accept ? 'Invitation accepted' : 'Invitation declined', property: populated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMyInvitations = async (req, res) => {
  try {
    const properties = await Property.find({
      'pmInvitation.invitedManager': req.user._id,
      'pmInvitation.status': 'pending',
    }).populate('landlord', 'name email');
    res.json(properties);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const assignManager = async (req, res) => {
  try {
    const { managerId } = req.body;
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ message: 'Property not found' });
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin only' });

    if (managerId) {
      const manager = await require('../models/User').findById(managerId);
      if (!manager || manager.role !== 'property_manager')
        return res.status(400).json({ message: 'User is not a property manager' });
      property.managedBy = managerId;
    } else {
      property.managedBy = null;
    }
    await property.save();

    const populated = await Property.findById(property._id).populate('managedBy', 'name email');
    res.json({ message: managerId ? 'Manager assigned' : 'Manager removed', property: populated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createProperty, getProperties, getPropertyById, updateProperty, deleteProperty,
  assignManager, inviteManager, respondToInvitation, getMyInvitations,
};
