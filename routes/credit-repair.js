const express = require('express');
const { getCollection } = require('../services/mongo');

function createCreditRepairRouter({ stripe, appBaseUrl }) {
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
        return_url: `${appBaseUrl}/credit-repair-intake.html?verification_session_id={VERIFICATION_SESSION_ID}`,
        metadata: {
          fullName,
          email,
          phone,
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
      console.error('[credit-repair] verification error', err);
      return res.status(500).json({ error: 'verification_failed' });
    }
  });

  router.post('/checkout-session', express.json(), async (req, res) => {
    try {
      if (!stripe?.checkout?.sessions?.create) {
        return res.status(500).json({ error: 'stripe_checkout_unavailable' });
      }

      const fullName = String(req.body?.fullName || '').trim();
      const email = String(req.body?.email || '').trim();
      const phone = String(req.body?.phone || '').trim();
      const verificationSessionId = String(req.body?.verificationSessionId || '').trim();

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        allow_promotion_codes: false,
        billing_address_collection: 'required',
        customer_email: email || undefined,
        metadata: {
          fullName,
          phone,
          verificationSessionId,
        },
        payment_intent_data: {
          metadata: {
            fullName,
            phone,
            verificationSessionId,
            purpose: 'credit_repair_enrollment_fee',
          },
        },
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Credit repair enrollment (2-6 months of service)',
                description: 'Upfront fee covering disputes, bureau communication, and coaching time.',
              },
              unit_amount: 90000,
            },
            quantity: 1,
          },
        ],
        success_url: `${appBaseUrl}/credit-repair-intake.html?checkout_session_id={CHECKOUT_SESSION_ID}&status=paid`,
        cancel_url: `${appBaseUrl}/credit-repair-intake.html?checkout_status=cancelled`,
      });

      return res.json({ id: session.id, url: session.url });
    } catch (err) {
      console.error('[credit-repair] checkout error', err);
      return res.status(500).json({ error: 'checkout_failed' });
    }
  });

  router.get('/checkout-session', async (req, res) => {
    try {
      if (!stripe?.checkout?.sessions?.retrieve) {
        return res.status(500).json({ error: 'stripe_checkout_unavailable' });
      }

      const sessionId = String(req.query?.session_id || req.query?.id || '').trim();
      if (!sessionId) {
        return res.status(400).json({ error: 'missing_session_id' });
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent'],
      });

      return res.json({
        id: session.id,
        payment_status: session.payment_status,
        amount_total: session.amount_total,
        currency: session.currency,
        payment_intent_status: session.payment_intent?.status || null,
      });
    } catch (err) {
      console.error('[credit-repair] checkout lookup error', err);
      return res.status(500).json({ error: 'lookup_failed' });
    }
  });

  router.post('/intake', express.json(), async (req, res) => {
    try {
      const payload = {
        fullName: String(req.body?.fullName || '').trim(),
        email: String(req.body?.email || '').trim(),
        phone: String(req.body?.phone || '').trim(),
        dob: String(req.body?.dob || '').trim(),
        address: String(req.body?.address || '').trim(),
        ssn: String(req.body?.ssn || '').trim(),
        goals: String(req.body?.goals || '').trim(),
        notes: String(req.body?.notes || '').trim(),
        verificationSessionId: String(req.body?.verificationSessionId || '').trim(),
        checkoutSessionId: String(req.body?.checkoutSessionId || '').trim(),
        consentAcknowledgement: Boolean(req.body?.consentAcknowledgement),
      };

      if (!payload.fullName || !payload.email || !payload.phone || !payload.ssn) {
        return res.status(400).json({ error: 'missing_required_fields' });
      }

      const col = await getCollection('credit_repair_intakes');
      await col.insertOne({
        ...payload,
        status: 'pending-review',
        submittedAt: new Date().toISOString(),
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('[credit-repair] intake error', err);
      return res.status(500).json({ error: 'intake_failed' });
    }
  });

  return router;
}

module.exports = createCreditRepairRouter;
