/**
 * billingController.js — Platform SaaS Subscription Billing
 *
 * Handles Stripe-based subscription management for RentifyPro's
 * Free / Pro / Enterprise tiers.
 *
 * Tier price IDs must be configured in .env:
 *   STRIPE_PRICE_PRO        — monthly price ID for Pro plan
 *   STRIPE_PRICE_ENTERPRISE — monthly price ID for Enterprise plan
 *
 * Tiers and feature limits:
 *   free:       Up to 2 properties, no clause builder, no S3 vault
 *   pro:        Up to 20 properties, clause builder, S3 vault, priority support
 *   enterprise: Unlimited properties, all features, custom branding
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');

// Feature limits per tier
const TIER_LIMITS = {
  free:       { maxProperties: 2,   clauseBuilder: false, documentVault: false },
  pro:        { maxProperties: 20,  clauseBuilder: true,  documentVault: true  },
  enterprise: { maxProperties: 999, clauseBuilder: true,  documentVault: true  },
};

const TIER_PRICES = {
  pro:        process.env.STRIPE_PRICE_PRO,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
};

// @desc    Get current subscription status and feature limits for logged-in user
// @route   GET /api/billing/status
// @access  Private
const getBillingStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('subscriptionTier name email stripeCustomerId');
    const tier = user.subscriptionTier || 'free';

    res.json({
      tier,
      limits: TIER_LIMITS[tier] || TIER_LIMITS.free,
      stripeCustomerId: user.stripeCustomerId || null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a Stripe Checkout Session to subscribe to a plan
// @route   POST /api/billing/subscribe
// @access  Private (Landlord)
const subscribe = async (req, res) => {
  try {
    const { tier } = req.body;

    if (!['pro', 'enterprise'].includes(tier)) {
      return res.status(400).json({ message: 'Invalid tier. Choose "pro" or "enterprise".' });
    }

    const priceId = TIER_PRICES[tier];
    if (!priceId) {
      return res.status(503).json({ message: `Stripe price ID for "${tier}" plan not configured.` });
    }

    const user = await User.findById(req.user._id).select('email name stripeCustomerId subscriptionTier');

    if (user.subscriptionTier === tier) {
      return res.status(400).json({ message: `You are already subscribed to the ${tier} plan.` });
    }

    // Create or reuse Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name:  user.name,
        metadata: { userId: req.user._id.toString() },
      });
      customerId = customer.id;
      await User.findByIdAndUpdate(req.user._id, { stripeCustomerId: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.CLIENT_URL}/dashboard/billing?success=true&tier=${tier}`,
      cancel_url:  `${process.env.CLIENT_URL}/dashboard/billing?canceled=true`,
      metadata: { userId: req.user._id.toString(), tier },
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a Stripe Customer Portal session to manage / cancel subscription
// @route   POST /api/billing/portal
// @access  Private
const openCustomerPortal = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('stripeCustomerId');

    if (!user.stripeCustomerId) {
      return res.status(400).json({ message: 'No billing account found. Please subscribe first.' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   user.stripeCustomerId,
      return_url: `${process.env.CLIENT_URL}/dashboard/billing`,
    });

    res.json({ url: portalSession.url });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Handle Stripe billing webhooks (subscription created / updated / deleted)
// @route   POST /api/billing/webhook  (raw body — registered in server.js)
// @access  Public (Stripe only)
const handleBillingWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_BILLING_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Billing Webhook Error: ${err.message}`);
  }

  // Map Stripe subscription status to our tier
  const _tierFromMetadata = (metadata) => {
    return ['pro', 'enterprise'].includes(metadata?.tier) ? metadata.tier : null;
  };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.mode === 'subscription') {
      const userId = session.metadata?.userId;
      const tier   = _tierFromMetadata(session.metadata);
      if (userId && tier) {
        await User.findByIdAndUpdate(userId, { subscriptionTier: tier });
        console.log(`🎉 Subscription activated: user=${userId} tier=${tier}`);
      }
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    const customer = await stripe.customers.retrieve(subscription.customer);
    const userId = customer.metadata?.userId;

    if (userId) {
      const status = subscription.status;
      // Downgrade to free if subscription is cancelled / unpaid
      if (['canceled', 'unpaid', 'past_due'].includes(status)) {
        await User.findByIdAndUpdate(userId, { subscriptionTier: 'free' });
        console.log(`📉 Subscription downgraded: user=${userId} status=${status}`);
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customer = await stripe.customers.retrieve(subscription.customer);
    const userId = customer.metadata?.userId;
    if (userId) {
      await User.findByIdAndUpdate(userId, { subscriptionTier: 'free' });
      console.log(`❌ Subscription cancelled: user=${userId}`);
    }
  }

  res.json({ received: true });
};

// @desc    Get available subscription plans
// @route   GET /api/billing/plans
// @access  Public
const getPlans = async (req, res) => {
  res.json({
    plans: [
      {
        tier: 'free',
        name: 'Free',
        price: 0,
        currency: 'PKR',
        interval: 'month',
        features: [
          'Up to 2 properties',
          'Basic agreement templates',
          'Email notifications',
          'Tenant portal',
        ],
        limits: TIER_LIMITS.free,
      },
      {
        tier: 'pro',
        name: 'Pro',
        price: 2999,
        currency: 'PKR',
        interval: 'month',
        stripePriceId: TIER_PRICES.pro || null,
        features: [
          'Up to 20 properties',
          'Clause builder with 50+ templates',
          'AWS S3 document vault',
          'SMS + Push notifications',
          'Priority support',
          'Advanced analytics',
        ],
        limits: TIER_LIMITS.pro,
      },
      {
        tier: 'enterprise',
        name: 'Enterprise',
        price: 9999,
        currency: 'PKR',
        interval: 'month',
        stripePriceId: TIER_PRICES.enterprise || null,
        features: [
          'Unlimited properties',
          'All Pro features',
          'Custom branding',
          'Dedicated account manager',
          'SLA guarantee',
          'API access',
          'White-label option',
        ],
        limits: TIER_LIMITS.enterprise,
      },
    ],
  });
};

module.exports = { getBillingStatus, subscribe, openCustomerPortal, handleBillingWebhook, getPlans, TIER_LIMITS };
