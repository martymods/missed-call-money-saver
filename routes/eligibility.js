// routes/eligibility.js
const express = require('express');
const router = express.Router();
const { submitEligibility, parse271 } = require('../services/eligibility');

// POST /api/eligibility/check
router.post('/check', async (req, res) => {
  try {
    const { payer, memberId, lastName, dob, zip } = req.body || {};
    if (!payer || !memberId || !lastName || !dob) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }

    // 1) Send a 270 to your clearinghouse
    const raw = await submitEligibility({ payer, memberId, lastName, dob, zip });

    // 2) Parse the 271 (works whether your vendor returns raw X12 or JSON)
    const normalized = parse271(raw);

    return res.json({
      ok: true,
      eligible: normalized.activeCoverage === true,
      planName: normalized.planName || null,
      copayEstimate: normalized.copay || null,
      deductibleRemaining: normalized.deductibleRemaining || null,
      networkStatus: normalized.networkStatus || null,
      // Only expose raw response while debugging:
      raw: process.env.DEBUG_271 ? raw : undefined,
    });
  } catch (e) {
    console.error('eligibility error', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

module.exports = router;
