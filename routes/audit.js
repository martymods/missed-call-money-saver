const express = require('express');
const { getAuditSummary } = require('../services/auditLog');

const ADMIN_SECRET = process.env.ADMIN_AUDIT_SECRET || '';

function createRouter(){
  const router = express.Router();

  router.get('/logs', async (req, res) => {
    const provided = req.headers['x-admin-secret'] || req.query.secret || '';
    if (!ADMIN_SECRET || provided !== ADMIN_SECRET){
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const data = await getAuditSummary();
      res.json({ ok: true, ...data });
    } catch (err){
      console.error('Audit log fetch error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  return router;
}

module.exports = createRouter;
