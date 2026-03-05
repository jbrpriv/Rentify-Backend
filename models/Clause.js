/**
 * models/Clause.js  — [FIX #4] Conditional clause logic
 *
 * Adds an optional `condition` block to each clause so the builder can
 * include or exclude a clause based on agreement field values.
 *
 * Condition schema  (all fields optional):
 *   {
 *     field:    string   — dot-notation path into the agreement variable map
 *                          e.g. "petPolicy.allowed", "financials.lateFeeAmount"
 *     operator: string   — one of: eq | ne | gt | gte | lt | lte | exists | in | contains
 *     value:    Mixed    — the value to compare against
 *   }
 *
 * Examples:
 *   Only include pet-policy clause if pets are allowed:
 *     { field: "petPolicy.allowed", operator: "eq", value: true }
 *
 *   Only include late-fee clause if a late fee is configured:
 *     { field: "financials.lateFeeAmount", operator: "gt", value: 0 }
 *
 *   Only include utilities clause if utilities are included:
 *     { field: "utilitiesIncluded", operator: "eq", value: true }
 *
 *   Always include (no condition set):
 *     condition field omitted or condition.field omitted
 */

const mongoose = require('mongoose');

const conditionSchema = new mongoose.Schema(
  {
    // Dot-notation key that maps into the raw agreement document
    // e.g. "financials.lateFeeAmount"
    field: {
      type: String,
      trim: true,
    },

    operator: {
      type: String,
      enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'exists', 'in', 'contains'],
      default: 'eq',
    },

    // The value to compare the field against.
    // For 'in' operator this should be an array.
    value: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { _id: false }
);

const clauseSchema = mongoose.Schema(
  {
    title: {
      type:     String,
      required: true,
      trim:     true,
    },
    body: {
      type:     String,
      required: true,
    },
    category: {
      type: String,
      enum: [
        'rent', 'deposit', 'maintenance', 'utilities', 'pets',
        'termination', 'renewal', 'late_fee', 'subletting', 'noise', 'general',
      ],
      default: 'general',
    },

    jurisdiction: {
      type:    String,
      default: 'Pakistan',
    },

    // ─── [FIX #4] Conditional inclusion ─────────────────────────────────────
    // If present and condition evaluates to false against a given agreement,
    // this clause is excluded from the clauseSet at PDF generation time.
    condition: {
      type:    conditionSchema,
      default: null,
    },

    // ─── Versioning ──────────────────────────────────────────────────────────
    version: {
      type:    Number,
      default: 1,
    },
    isLatestVersion: {
      type:    Boolean,
      default: true,
    },

    // ─── Approval Workflow ───────────────────────────────────────────────────
    isApproved: {
      type:    Boolean,
      default: false,
    },
    approvedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },
    approvedAt: {
      type:    Date,
      default: null,
    },
    rejectionReason: {
      type:    String,
      default: '',
    },

    // ─── Usage ───────────────────────────────────────────────────────────────
    isArchived: {
      type:    Boolean,
      default: false,
    },
    isDefault: {
      type:    Boolean,
      default: false,
    },
    usageCount: {
      type:    Number,
      default: 0,
    },

    createdBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Clause', clauseSchema);
