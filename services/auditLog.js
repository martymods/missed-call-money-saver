const { getCollection } = require('./mongo');

async function recordAuditLog(entry = {}){
  try {
    const col = await getCollection('auditLogs');
    if (!col) return;
    const payload = {
      ...entry,
      createdAt: new Date().toISOString(),
    };
    await col.insertOne(payload);
  } catch (err){
    console.error('Audit log write failed', err);
  }
}

async function getAuditSummary(limit = 200){
  const col = await getCollection('auditLogs');
  if (!col) return { summary: { total: 0, byType: {}, byUser: {}, metrics: {}, lastEvent: null }, logs: [] };
  const cursor = await col.find({});
  const rows = await cursor.toArray();
  rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const limited = rows.slice(0, limit);
  const summary = {
    total: rows.length,
    byType: {},
    byUser: {},
    metrics: {},
    lastEvent: limited[0]?.createdAt || null,
  };
  limited.forEach(row => {
    const type = row.type || 'unknown';
    summary.byType[type] = (summary.byType[type] || 0) + 1;
    const userId = row.userId || 'unknown';
    summary.byUser[userId] = (summary.byUser[userId] || 0) + 1;
    if (row.counts){
      Object.entries(row.counts).forEach(([metric, value]) => {
        summary.metrics[metric] = (summary.metrics[metric] || 0) + Number(value || 0);
      });
    }
  });
  return { summary, logs: limited };
}

module.exports = {
  recordAuditLog,
  getAuditSummary,
};
