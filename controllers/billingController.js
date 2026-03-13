/**
 * billingController.js — Platform SaaS Subscription Billing
 *
 * Handles Stripe-based subscription management for RentifyPro's
 * Free / Pro / Enterprise tiers.
 *
 * Required environment variables:
 *   STRIPE_SECRET_KEY           — Stripe secret key
 *   STRIPE_PRICE_PRO            — Monthly price ID for the Pro plan
 *   STRIPE_PRICE_ENTERPRISE     — Monthly price ID for the Enterprise plan
 *   STRIPE_WEBHOOK_SECRET       — Billing webhook signing secret
 *   CLIENT_URL                  — Frontend origin for redirect URLs
 *
 * Tiers and feature limits:
 *   free:       1 property, no clause builder, no S3 vault
 *   pro:        Up to 20 properties, clause builder, S3 vault, priority support
 *   enterprise: Unlimited properties, all features, custom branding
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');

// ─── Tier feature limits ──────────────────────────────────────────────────────
const TIER_LIMITS = {
  free: { maxProperties: 1, clauseBuilder: false, documentVault: false, analytics: false, agreementTemplates: false },
  pro: { maxProperties: 5, clauseBuilder: true, documentVault: true, analytics: true, agreementTemplates: false },
  enterprise: { maxProperties: -1, clauseBuilder: true, documentVault: true, analytics: true, agreementTemplates: true },
};

// Stripe price IDs are set via environment variables so they can be changed
// without code changes when switching between test/live mode.
const TIER_PRICES = {
  pro: process.env.STRIPE_PRICE_PRO,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
};

/** Returns true when all required Stripe environment variables are present. */
const stripeConfigured = () =>
  !!(process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_PRICE_PRO &&
    process.env.STRIPE_PRICE_ENTERPRISE);

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout Session for a subscription upgrade.
 * Handles automatic currency-conflict recovery: if the existing Stripe customer
 * already has a subscription in a different currency, Stripe rejects the request
 * with 'currency_combination_invalid'. In that case we provision a fresh customer
 * and retry once.
 *
 * @param {object} opts
 * @param {string} opts.customerId   - Existing Stripe customer ID
 * @param {string} opts.priceId      - Stripe price ID to subscribe to
 * @param {string} opts.userId       - Internal MongoDB user ID (stored in metadata)
 * @param {string} opts.tier         - 'pro' | 'enterprise'
 * @param {string} opts.userEmail    - Customer email (used for pre-fill)
 * @param {string} opts.userName     - Customer display name
 * @returns {Promise<Stripe.Checkout.Session>}
 */
async function _createCheckoutSession({ customerId, priceId, userId, tier, userEmail, userName }) {
  return stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${process.env.CLIENT_URL}/dashboard/billing?success=true&tier=${tier}`,
    cancel_url: `${process.env.CLIENT_URL}/dashboard/billing?canceled=true`,
    metadata: { userId, tier },
  });
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/**
 * @desc  Get current subscription status and feature limits for the logged-in user
 * @route GET /api/billing/status
 * @access Private
 */
const getBillingStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('subscriptionTier name email stripeCustomerId');
    const tier = user.subscriptionTier || 'free';

    const rawLimits = TIER_LIMITS[tier] || TIER_LIMITS.free;
    const limits = {
      ...rawLimits,
      maxProperties: rawLimits.maxProperties === -1 ? null : rawLimits.maxProperties,
    };

    res.json({
      tier,
      limits,
      stripeCustomerId: user.stripeCustomerId || null,
      stripeConfigured: stripeConfigured(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc  Create a Stripe Checkout Session to subscribe to a plan
 * @route POST /api/billing/subscribe
 * @access Private (Landlord)
 */
const subscribe = async (req, res) => {
  try {
    const { tier } = req.body;

    if (!['pro', 'enterprise'].includes(tier)) {
      return res.status(400).json({ message: 'Invalid tier. Choose "pro" or "enterprise".' });
    }

    // Graceful degradation when Stripe is not yet configured
    if (!stripeConfigured()) {
      return res.status(503).json({
        message: 'Online payments are not yet configured. Please contact the administrator.',
        stripeConfigured: false,
      });
    }

    const priceId = TIER_PRICES[tier];
    if (!priceId) {
      return res.status(503).json({
        message: `The ${tier} plan price is not configured. Please contact support.`,
        stripeConfigured: false,
      });
    }

    const user = await User.findById(req.user._id)
      .select('email name stripeCustomerId subscriptionTier');

    if (user.subscriptionTier === tier) {
      return res.status(400).json({ message: `You are already on the ${tier} plan.` });
    }

    // Create or reuse the Stripe customer record
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: req.user._id.toString() },
      });
      customerId = customer.id;
      await User.findByIdAndUpdate(req.user._id, { stripeCustomerId: customerId });
    }

    let session;
    try {
      session = await _createCheckoutSession({
        customerId,
        priceId,
        userId: req.user._id.toString(),
        tier,
        userEmail: user.email,
        userName: user.name,
      });
    } catch (stripeErr) {
      // Currency conflict: existing customer has subscriptions in a different currency.
      // Provision a fresh Stripe customer and retry once.
      const isCurrencyConflict =
        stripeErr.code === 'currency_combination_invalid' ||
        (stripeErr.message && stripeErr.message.toLowerCase().includes('cannot combine currencies'));

      if (!isCurrencyConflict) throw stripeErr;

      const freshCustomer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: req.user._id.toString() },
      });
      customerId = freshCustomer.id;
      await User.findByIdAndUpdate(req.user._id, { stripeCustomerId: customerId });

      session = await _createCheckoutSession({
        customerId,
        priceId,
        userId: req.user._id.toString(),
        tier,
        userEmail: user.email,
        userName: user.name,
      });
    }

    res.json({ url: session.url });
  } catch (error) {
    logger.error('[billing] subscribe error', { err: error.message });
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc  Open the Stripe customer portal to manage or cancel a subscription
 * @route POST /api/billing/portal
 * @access Private
 */
const openCustomerPortal = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('stripeCustomerId');

    if (!user.stripeCustomerId) {
      return res.status(400).json({
        message: 'No active subscription found. Please subscribe to a plan first.',
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.CLIENT_URL}/dashboard/billing`,
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc  Handle Stripe billing webhooks (subscription lifecycle events)
 * @route POST /api/billing/webhook
 * @access Public (Stripe signature verified internally)
 */
const handleBillingWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_BILLING_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Subscription successfully activated or renewed
  if (event.type === 'checkout.session.completed' && event.data.object.mode === 'subscription') {
    const session = event.data.object;
    const { userId, tier } = session.metadata;

    if (userId && tier) {
      await User.findByIdAndUpdate(userId, {
        subscriptionTier: tier,
        subscriptionStartDate: new Date(),
      });
    }
  }

  // Subscription status changed (downgrade on unpaid / cancellation)
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    const customer = await stripe.customers.retrieve(subscription.customer);
    const userId = customer.metadata?.userId;

    if (userId) {
      const { status } = subscription;
      if (['canceled', 'unpaid', 'past_due'].includes(status)) {
        await User.findByIdAndUpdate(userId, { subscriptionTier: 'free' });
      }
    }
  }

  // Subscription cancelled — revert user to free tier
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customer = await stripe.customers.retrieve(subscription.customer);
    const userId = customer.metadata?.userId;
    if (userId) {
      await User.findByIdAndUpdate(userId, { subscriptionTier: 'free' });
    }
  }

  res.json({ received: true });
};

/**
 * @desc  Get available subscription plans with pricing and feature lists
 * @route GET /api/billing/plans
 * @access Public
 */
const getPlans = async (_req, res) => {
  res.json({
    stripeConfigured: stripeConfigured(),
    plans: [
      {
        tier: 'free',
        name: 'Free',
        price: 0,
        currency: 'USD',
        interval: 'month',
        features: [
          '1 property listing (max)',
          'Email notifications',
          'Tenant portal',
          'Basic dashboard',
        ],
        limits: TIER_LIMITS.free,
      },
      {
        tier: 'pro',
        name: 'Pro',
        price: 15,
        currency: 'USD',
        interval: 'month',
        stripePriceId: TIER_PRICES.pro || null,
        features: [
          'Up to 5 properties',
          'Clause builder with 50+ templates',
          'AWS S3 document vault',
          'SMS + Push notifications',
          'Priority support',
          'Analytics dashboard',
        ],
        limits: TIER_LIMITS.pro,
      },
      {
        tier: 'enterprise',
        name: 'Enterprise',
        price: 30,
        currency: 'USD',
        interval: 'month',
        stripePriceId: TIER_PRICES.enterprise || null,
        features: [
          'Unlimited properties',
          'All Pro features',
          'Agreement templates library',
          'Custom branding',
          'Dedicated account manager',
          'SLA guarantee',
          'API access',
        ],
        limits: { ...TIER_LIMITS.enterprise, maxProperties: null },
      },
    ],
  });
};

module.exports = {
  getBillingStatus,
  subscribe,
  openCustomerPortal,
  handleBillingWebhook,
  getPlans,
  TIER_LIMITS,
};