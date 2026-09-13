export const statusLabel = value => ({pending: 'Awaiting Review', approved: 'Approved', rejected: 'Not Approved', unknown: 'Not in review'})[value] || value;
export function latestReview(records) { return records.filter(r => r.status === 'pending').sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.id.localeCompare(b.id)).slice(0,8); }
