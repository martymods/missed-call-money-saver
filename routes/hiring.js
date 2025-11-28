const express = require('express');
const { getCollection } = require('../services/mongo');

function createHiringRouter({ stripe, appBaseUrl }) {
  const router = express.Router();

  router.post('/start-verification', express.json(), async (req, res) => {
    try {
      if (!stripe?.identity?.verificationSessions?.create) {
        return res.status(500).json({ error: 'stripe_identity_unavailable' });
      }

      const fullName = String(req.body?.fullName || '').trim();
      const email = String(req.body?.email || '').trim();
      const phone = String(req.body?.phone || '').trim();

      const verification = await stripe.identity.verificationSessions.create({
        type: 'document',
        return_url: `${appBaseUrl}/hiring-foreign-workers.html?verification_session_id={VERIFICATION_SESSION_ID}`,
        metadata: {
          fullName,
          email,
          phone,
          purpose: 'hiring_foreign_workers',
        },
        options: {
          document: {
            require_live_capture: true,
            require_matching_selfie: true,
          },
        },
      });

      return res.json({ id: verification.id, url: verification.url });
    } catch (err) {
      console.error('[hiring] verification error', err);
      return res.status(500).json({ error: 'verification_failed' });
    }
  });

  router.get('/verification-session', async (req, res) => {
    try {
      if (!stripe?.identity?.verificationSessions?.retrieve) {
        return res.status(500).json({ error: 'stripe_identity_unavailable' });
      }

      const sessionId = String(req.query?.id || req.query?.verification_session_id || '').trim();
      if (!sessionId) {
        return res.status(400).json({ error: 'missing_session_id' });
      }

      const session = await stripe.identity.verificationSessions.retrieve(sessionId);
      return res.json({
        id: session.id,
        status: session.status,
        last_error: session.last_error || null,
        verified_outputs: session.verified_outputs || null,
      });
    } catch (err) {
      console.error('[hiring] verification lookup error', err);
      return res.status(500).json({ error: 'verification_lookup_failed' });
    }
  });

  router.post('/apply', express.json(), async (req, res) => {
    try {
      const payload = {
        fullName: String(req.body?.fullName || '').trim(),
        email: String(req.body?.email || '').trim(),
        phone: String(req.body?.phone || '').trim(),
        role: String(req.body?.role || '').trim(),
        shift: String(req.body?.shift || '').trim(),
        locationFocus: String(req.body?.locationFocus || '').trim(),
        vehicleNeeds: Boolean(req.body?.vehicleNeeds),
        notes: String(req.body?.notes || '').trim(),
        verificationSessionId: String(req.body?.verificationSessionId || '').trim(),
        sourcingChannel: String(req.body?.sourcingChannel || '').trim(),
      };

      if (!payload.fullName || !payload.phone || !payload.role) {
        return res.status(400).json({ error: 'missing_required_fields' });
      }

      const col = await getCollection('hiring_applicants');
      await col.insertOne({
        ...payload,
        submittedAt: new Date().toISOString(),
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[hiring] apply error', err);
      return res.status(500).json({ error: 'apply_failed' });
    }
  });

  return router;
}

module.exports = createHiringRouter;
