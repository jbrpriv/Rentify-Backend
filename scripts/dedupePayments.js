/*
  dedupePayments.js

  Purpose:
  - Detect and optionally remove duplicate Payment rows that represent the same
    Stripe transaction (same stripeSessionId or same stripePaymentIntent).
  - Report logical duplicates (same agreement+dueDate rent entries, duplicate
    initial entries) for manual review.

  Usage:
    node scripts/dedupePayments.js            # dry run (no DB writes)
    node scripts/dedupePayments.js --apply    # delete safe duplicates

  Notes:
  - Requires MONGO_URI in environment.
  - Only "safe" duplicates are auto-removed on --apply:
      * same stripeSessionId
      * same stripePaymentIntent
  - Logical duplicates with different Stripe IDs are reported only.
*/

require('dotenv').config({ override: false });
const mongoose = require('mongoose');
const Payment = require('../models/Payment');

const APPLY = process.argv.includes('--apply');

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toISOString();
}

function pickCanonical(docs) {
  // Prefer paid over pending_approval, then earliest created record.
  const statusRank = (s) => {
    if (s === 'paid') return 0;
    if (s === 'pending_approval') return 1;
    return 2;
  };

  return [...docs].sort((a, b) => {
    const sr = statusRank(a.status) - statusRank(b.status);
    if (sr !== 0) return sr;
    return new Date(a.createdAt) - new Date(b.createdAt);
  })[0];
}

async function dedupeByStripeField(fieldName) {
  const groups = await Payment.aggregate([
    {
      $match: {
        [fieldName]: { $type: 'string' },
      },
    },
    {
      $group: {
        _id: `$${fieldName}`,
        ids: { $push: '$_id' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (groups.length === 0) {
    console.log(`[OK] No duplicates by ${fieldName}.`);
    return { groups: 0, removed: 0 };
  }

  let removed = 0;

  for (const g of groups) {
    const docs = await Payment.find({ _id: { $in: g.ids } }).sort({ createdAt: 1 });
    const canonical = pickCanonical(docs);
    const duplicateIds = docs
      .filter((d) => d._id.toString() !== canonical._id.toString())
      .map((d) => d._id);

    console.log(`\n[DUP] ${fieldName}=${g._id}`);
    console.log(`  keep:   ${canonical._id} status=${canonical.status} createdAt=${fmtDate(canonical.createdAt)} amount=${canonical.amount}`);
    duplicateIds.forEach((id) => {
      const d = docs.find((x) => x._id.toString() === id.toString());
      console.log(`  remove: ${id} status=${d?.status} createdAt=${fmtDate(d?.createdAt)} amount=${d?.amount}`);
    });

    if (APPLY && duplicateIds.length > 0) {
      const result = await Payment.deleteMany({ _id: { $in: duplicateIds } });
      removed += result.deletedCount || 0;
    }
  }

  return { groups: groups.length, removed };
}

async function reportLogicalDuplicates() {
  // Rent duplicates for same period that are in "successful-ish" states.
  const rentGroups = await Payment.aggregate([
    {
      $match: {
        type: 'rent',
        status: { $in: ['pending_approval', 'paid'] },
        dueDate: { $type: 'date' },
      },
    },
    {
      $group: {
        _id: {
          agreement: '$agreement',
          dueDate: '$dueDate',
        },
        ids: { $push: '$_id' },
        intents: { $addToSet: '$stripePaymentIntent' },
        sessions: { $addToSet: '$stripeSessionId' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  // Initial duplicates for same agreement.
  const initialGroups = await Payment.aggregate([
    {
      $match: {
        type: 'initial',
        status: { $in: ['pending_approval', 'paid'] },
      },
    },
    {
      $group: {
        _id: '$agreement',
        ids: { $push: '$_id' },
        intents: { $addToSet: '$stripePaymentIntent' },
        sessions: { $addToSet: '$stripeSessionId' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (rentGroups.length === 0 && initialGroups.length === 0) {
    console.log('\n[OK] No logical duplicate groups found.');
    return;
  }

  if (rentGroups.length > 0) {
    console.log(`\n[WARN] Logical rent duplicates found: ${rentGroups.length}`);
    rentGroups.forEach((g) => {
      console.log(`  agreement=${g._id.agreement} dueDate=${fmtDate(g._id.dueDate)} count=${g.count}`);
      console.log(`    intents=${JSON.stringify(g.intents)}`);
      console.log(`    sessions=${JSON.stringify(g.sessions)}`);
      console.log(`    ids=${g.ids.map((x) => x.toString()).join(', ')}`);
    });
  }

  if (initialGroups.length > 0) {
    console.log(`\n[WARN] Logical initial duplicates found: ${initialGroups.length}`);
    initialGroups.forEach((g) => {
      console.log(`  agreement=${g._id} count=${g.count}`);
      console.log(`    intents=${JSON.stringify(g.intents)}`);
      console.log(`    sessions=${JSON.stringify(g.sessions)}`);
      console.log(`    ids=${g.ids.map((x) => x.toString()).join(', ')}`);
    });
  }
}

(async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is required.');
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`[INFO] Connected to MongoDB. Mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

    const s1 = await dedupeByStripeField('stripeSessionId');
    const s2 = await dedupeByStripeField('stripePaymentIntent');

    await reportLogicalDuplicates();

    console.log('\n[SUMMARY]');
    console.log(`  stripeSessionId groups: ${s1.groups}, removed: ${s1.removed}`);
    console.log(`  stripePaymentIntent groups: ${s2.groups}, removed: ${s2.removed}`);

    if (!APPLY) {
      console.log('\n[NOTE] Dry-run only. Re-run with --apply to delete safe duplicates.');
    }
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
})();
