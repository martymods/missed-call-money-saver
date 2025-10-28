function parseLimit(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function applyLimit(list, limit) {
  if (!Array.isArray(list)) return [];
  if (!limit || limit >= list.length) return list;
  return list.slice(0, limit);
}

module.exports = {
  parseLimit,
  applyLimit,
};
