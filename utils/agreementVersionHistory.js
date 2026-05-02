const Agreement = require('../models/Agreement');

const buildVersionSnapshot = (agreement, userId, reason = '') => ({
  version: (agreement.versionHistory?.length || 0) + 1,
  savedAt: new Date(),
  savedBy: userId,
  reason,
  snapshot: {
    clauses: (agreement.clauseSet || []).map((clause) => clause.title || clause.clauseId?.toString() || ''),
    financials: agreement.financials,
    term: agreement.term,
    status: agreement.status,
  },
});

const appendVersionSnapshot = async (agreement, userId, reason = '') => {
  if (!agreement) return null;

  agreement.versionHistory = agreement.versionHistory || [];
  agreement.versionHistory.push(buildVersionSnapshot(agreement, userId, reason));

  if (typeof agreement.save === 'function') {
    await agreement.save();
  }

  return agreement.versionHistory[agreement.versionHistory.length - 1].version;
};

const saveVersionSnapshot = async (agreementId, userId, reason = 'Manual save') => {
  const agreement = await Agreement.findById(agreementId);
  if (!agreement) return null;

  return appendVersionSnapshot(agreement, userId, reason);
};

module.exports = {
  buildVersionSnapshot,
  appendVersionSnapshot,
  saveVersionSnapshot,
};