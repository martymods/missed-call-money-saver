// routes/eligibility-dxc.js
const express = require('express');

const router = express.Router();

const CHG_URL      = process.env.CHG_URL;         // host or full endpoint
const CHG_API_KEY  = process.env.CHG_API_KEY;     // DXC API key (keep secret)
const DXC_USER     = process.env.DXC_USER;        // sandbox username
const DXC_PASS     = process.env.DXC_PASS;        // sandbox password
const DXC_GROUP_ID = process.env.DXC_GROUP_ID ? Number(process.env.DXC_GROUP_ID) : undefined;

const PAYER_MAP = (() => {
  try { return JSON.parse(process.env.CHG_PAYER_MAP || '{}'); } catch { return {}; }
})();
const mapPayer = (v) => {
  if (!v) return undefined;
  const k = String(v).trim();
  return PAYER_MAP[k] || k; // allows "Aetna Dental" or "60054"
};

function parseEligibility(resp) {
  const out = { active:false, planName:null, copay:null };
  const r = resp?.response || resp;
  if (Array.isArray(r?.activeCoverage) && r.activeCoverage.length) out.active = true;
  out.planName = r?.planName || r?.plan?.planName || r?.payer?.name || null;
  return out;
}

// POST /api/eligibility-dxc/check
router.post('/check', async (req, res) => {
  try {
    const { payer, memberId, dob, lastName, firstName, zip } = req.body || {};
    if (!memberId || !dob) return res.status(400).json({ ok:false, error:'memberId and dob are required' });

    const body = {
      provider: {  // use real provider data in prod
        type: "1", firstName: "John", lastName: "Smith",
        npi: "1111111111", taxId: "111111111"
      },
      payer: {
        name: payer || undefined,
        payerIdCode: mapPayer(payer),
        id: mapPayer(payer)
      },
      patient: {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        dateOfBirth: dob,
        memberId: memberId,
        relationship: "18"  // Self
      },
      subscriber: {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        dateOfBirth: dob,
        memberId: memberId
      },
      dxcGroupId: DXC_GROUP_ID
    };

    const base = (CHG_URL || '').replace(/\/$/, '');
    const url = /\/eligibility$/.test(base) ? base : `${base}/sandbox/eligibility`;

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-Key': CHG_API_KEY,
        'username': DXC_USER,
        'password': DXC_PASS
      },
      body: JSON.stringify(body)
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ ok:false, error:'DXC error', status:r.status, data });

    const parsed = parseEligibility(data);
    res.json({
      ok: true,
      eligible: parsed.active,
      planName: parsed.planName,
      copayEstimate: parsed.copay || null,
      raw: process.env.DEBUG_271 ? data : undefined
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:'server' });
  }
});

module.exports = router;
