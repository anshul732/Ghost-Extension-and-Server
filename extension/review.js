export const REVIEW_LIMIT = 8;
export const statusLabel = value => ({pending: 'Awaiting Review', approved: 'Approved', rejected: 'Not Approved', unknown: 'Not in review'})[value] || value;
// Top pending opportunities. When relevance scores are present, rank by score
// (highest fit first); otherwise fall back to newest-first by creation date.
export function latestReview(records, scores = {}) {
  const pending = records.filter(r => r.status === 'pending');
  const byDate = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.id.localeCompare(b.id);
  const scored = pending.some(r => scores[r.id]);
  return pending.slice().sort(scored
    ? (a, b) => ((scores[b.id]?.score ?? -1) - (scores[a.id]?.score ?? -1)) || byDate(a, b)
    : byDate).slice(0, REVIEW_LIMIT);
}
