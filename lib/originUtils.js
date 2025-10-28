function normalizeOrigins(origins) {
  if (!origins) return [];
  if (Array.isArray(origins)) {
    return origins
      .map(origin => (typeof origin === 'string' ? origin.trim() : ''))
      .filter(Boolean);
  }
  if (typeof origins === 'string') {
    return origins
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean);
  }
  return [];
}

function createCorsMiddleware(allowedOrigins) {
  const origins = normalizeOrigins(allowedOrigins);
  if (origins.length === 0) {
    return null;
  }

  return function corsMiddleware(req, res, next) {
    const requestOrigin = req.headers.origin;
    if (!requestOrigin || origins.includes(requestOrigin)) {
      if (requestOrigin) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      const requestedHeaders = req.headers['access-control-request-headers'];
      res.setHeader('Access-Control-Allow-Headers', requestedHeaders || 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      next();
      return;
    }

    res.status(403).json({ error: 'cors_not_allowed' });
  };
}

module.exports = {
  normalizeOrigins,
  createCorsMiddleware,
};
