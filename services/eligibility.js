// services/eligibility.js
//
// submitEligibility: sends a 270 to your clearinghouse (generic HTTP POST).
// parse271: converts raw 271 (X12 or JSON) into { activeCoverage, planName, copay, deductibleRemaining, networkStatus }.

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

/**
 * Submit a 270 request to your clearinghouse.
 * Configure these env vars on Render:
 *   CHG_URL         -> e.g. https://api.your-clearinghouse.com/eligibility
 *   CHG_API_KEY     -> your bearer or basic key
 *   CHG_PAYER_MAP   -> optional JSON map { "Delta Dental":"delta_dental_code", "Aetna Dental":"aetna_code" }
 */
async function submitEligibility({ payer, memberId, lastName, dob, zip }) {
  const url = process.env.CHG_URL;
  const key = process.env.CHG_API_KEY;

  if (!url || !key) throw new Error('Missing CHG_URL or CHG_API_KEY');

  // Map human payer name to clearinghouse payer code (optional but recommended)
  let payerCode = payer;
  try {
    if (process.env.CHG_PAYER_MAP) {
      const map = JSON.parse(process.env.CHG_PAYER_MAP);
      if (map[payer]) payerCode = map[payer];
    }
  } catch {}

  // Most vendors accept JSON and return either JSON or raw X12 271 in a field.
  const body = {
    transaction: '270',
    payer: payerCode,
    subscriber: { memberId, lastName, dob, zip }
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,       // If your vendor uses Basic, change to: 'Authorization': 'Basic ' + key
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Clearinghouse error ${resp.status}: ${text}`);
  }

  // Try JSON first
  const text = await resp.text();
  try {
    return JSON.parse(text);         // Vendor already parsed the 271 for you
  } catch {
    return text;                     // Raw X12 271 string — we'll parse below
  }
}

/**
 * parse271: normalize 271 to a simple object.
 * Works if:
 *  - input is raw X12 string, or
 *  - input is JSON with either an 'x12' field, or a 'benefits' structure some vendors provide
 */
function parse271(payload) {
  // already normalized by your vendor?
  if (payload && payload.benefits && typeof payload.benefits === 'object') {
    return normalizeFromVendorJSON(payload);
  }

  // vendor returned { x12: 'ISA*...~' } style
  if (payload && typeof payload.x12 === 'string') {
    return parseX12_271(payload.x12);
  }

  // raw X12 string?
  if (typeof payload === 'string' && payload.includes('EB*')) {
    return parseX12_271(payload);
  }

  // last resort: try to find obvious fields if vendor returns some other JSON
  return {
    activeCoverage: !!payload?.active,
    planName: payload?.planName || null,
    copay: payload?.copay || null,
    deductibleRemaining: payload?.deductibleRemaining || null,
    networkStatus: payload?.networkStatus || null,
  };
}

// If vendor already gives JSON benefits, map them.
function normalizeFromVendorJSON(json) {
  const out = {
    activeCoverage: toBool(json.active || json.coverageActive),
    planName: json.planName || (json.plan && json.plan.name) || null,
    copay: firstNumber(json.copay, json.estimatedCopay),
    deductibleRemaining: firstNumber(json.deductibleRemaining, json.remainingDeductible),
    networkStatus: json.network || json.networkStatus || null,
  };
  // Some vendors put benefits in arrays; pick a dental office visit if present:
  if (Array.isArray(json.benefits)) {
    const dental = json.benefits.find(b => /dental|oral/i.test(b.service || '') || /dental/i.test(b.category || '')) || json.benefits[0];
    if (dental) {
      out.copay = firstNumber(out.copay, dental.copay, dental.amount);
      out.networkStatus = out.networkStatus || dental.network;
      out.activeCoverage = toBool(dental.active !== false);
    }
  }
  return out;
}

// Ultra-light 271 parser (raw X12). Not exhaustive—pulls the common bits most practices care about.
function parseX12_271(x12) {
  const segs = x12.split('~').map(s => s.trim()).filter(Boolean);
  let planName = null;
  let activeCoverage = false;
  let copay = null;
  let deductibleRemaining = null;
  let networkStatus = null;

  for (const seg of segs) {
    const el = seg.split('*');

    // EB segment (Eligibility or Benefit Information)
    // EB01: Coverage level/Info type (1=Active, 6=Inactive). EB06: Monetary Amount. EB07: Percent.
    if (el[0] === 'EB') {
      const eb01 = el[1];           // '1' active, '6' inactive (common values)
      const eb02 = el[2] || '';     // Service Type Code (e.g., '35' = Dental Care)
      const eb06 = el[6];           // Amount (copay/benefit amount)
      const eb07 = el[7];           // Percent

      if (eb01 === '1') activeCoverage = true;
      if (eb01 === '6') activeCoverage = false;

      // If service type includes Dental (35) or generic office visit, try to capture a copay
      if ((/35/.test(eb02) || /office|exam|visit/i.test(seg)) && isNumber(eb06)) {
        copay = Number(eb06);
      }
    }

    // MSG can contain plan text
    if (el[0] === 'MSG' && !planName) {
      planName = el.slice(1).join(' ').replace(/\*/g, ' ').trim();
    }

    // AMT*R has Remaining Deductible (varies by payer)
    if (el[0] === 'AMT' && el[1] === 'R' && isNumber(el[2])) {
      deductibleRemaining = Number(el[2]);
    }

    // AAA often indicates errors; if present with N**04, coverage not found
    if (el[0] === 'AAA' && el[3] === '04') {
      activeCoverage = false;
    }

    // Note: some payers use MSG/III/NTE for network hints; we keep it simple here
  }

  return {
    activeCoverage,
    planName,
    copay,
    deductibleRemaining,
    networkStatus,
  };
}

function isNumber(v) {
  return typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v));
}
function firstNumber(...vals) {
  for (const v of vals) if (isNumber(v)) return Number(v);
  return null;
}
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return /^(true|1|yes)$/i.test(v);
  return !!v;
}

module.exports = { submitEligibility, parse271 };
