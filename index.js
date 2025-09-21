require('dotenv').config();
const express = require('express');
const dayjs = require('dayjs');
const cron = require('node-cron');
const path = require('path');
const Stripe = require('stripe');
const OpenAI = require('openai');                           // 👈 NEW
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || '');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' }); // 👈 NEW
const APP_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://www.delcotechdivision.com';

const { sendSMS } = require('./services/twilioClient');
const { upsertByPhone, findAll } = require('./services/sheets');
const { subscribeCalendlyWebhook } = require('./services/calendly');
const { setStep, setField, get: getState } = require('./lib/leadStore');

/* ======================= HIRE CATALOG + PRICING ======================= */

const HIRE_SERVICES = [
  {
    key: 'discord_server',
    title: 'Discord Server — 24h Setup/Overhaul',
    tagline: 'Bots • Roles • Automations • Clean structure',
    blurb: 'Sleek, organized, bot-enhanced setup to engage members and keep mods in control.',
    tiers: [
      { key:'starter',  label:'Starter',  price:  30 },
      { key:'standard', label:'Standard', price:  40 },
      { key:'advanced', label:'Advanced', price:  50 },
    ],
    addons: [
      { key:'extra_rev',        label:'Additional Revision', price:25 },
      { key:'db_integration',   label:'Database Integration', price:25 },
      { key:'ai_faq',           label:'AI FAQ Bot',           price:15 },
      { key:'ai_welcome',       label:'AI Welcome Bot',       price:10 },
      { key:'npc_crystal',      label:'24/7 Crystal NPC Bot', price:20 },
    ]
  },
  {
    key: 'viewer_prediction',
    title: 'Skill-Based Viewer Prediction Game (PvP Wagers)',
    tagline: 'TikTok/Twitch/YT chat picks • wallets • payouts • OBS overlay',
    blurb: 'Plug-and-play engine for AI-vs-AI shows with odds, streak bonuses, auto-settlement, ledgers.',
    tiers: [
      { key:'starter',  label:'Starter',  price:  499 },
      { key:'standard', label:'Standard', price: 1199 },
      { key:'advanced', label:'Advanced', price: 2499 },
    ],
    addons: [
      { key:'fast',           label:'Fast Delivery', price:250 },
      { key:'extra_platform', label:'Extra Platform (TikTok/Twitch/YT)', price:150 },
      { key:'stripe_paypal',  label:'Stripe/PayPal Payments', price:400 },
      { key:'discord_bot',    label:'Discord Bot Integration', price:300 },
    ]
  },
  {
    key: 'ai_quote_pay_book',
    title: 'AI Quote → Pay → Book (Stripe • Calendly • Twilio)',
    tagline: 'Turn visits into scheduled, paid jobs',
    blurb: 'Asks smart questions, calculates price, collects payment, locks the appointment, logs to Sheets.',
    tiers: [
      { key:'starter',  label:'Starter',  price:  299 },
      { key:'standard', label:'Standard', price:  699 },
      { key:'advanced', label:'Advanced', price: 1199 },
    ],
    addons: [
      { key:'add_platform',    label:'Add a messaging platform', price:200 },
      { key:'sms_compliance',  label:'SMS Compliant Registration', price:250 },
      { key:'custom_calc',     label:'Custom calculator fields', price:150 },
    ]
  },
  {
    key: 'discord_arena',
    title: 'Discord AI Arena — PvP Bets & Leaderboards',
    tagline: 'Virtual wagers • roles via Stripe • scheduled fights',
    blurb: 'Challenge/accept bets, auto-resolve results, standings in embeds with buttons. Admin tools included.',
    tiers: [
      { key:'starter',  label:'Starter',  price:  299 },
      { key:'standard', label:'Standard', price:  699 },
      { key:'advanced', label:'Advanced', price: 1299 },
    ],
    addons: [
      { key:'extra_server', label:'+1 Discord Server',    price: 99  },
      { key:'paypal',       label:'Add PayPal Checkout',  price: 150 },
      { key:'dashboard',    label:'Admin Web Dashboard',  price: 300 },
    ]
  },
  {
    key: 'crypto_frontend',
    title: 'Crypto Exchange Frontend (Next.js + Charts)',
    tagline: 'Candles + volume • EMA/SMA • crosshair • wagmi/viem opt-in',
    blurb: 'Performance-oriented, mobile-first token market + detail pages with trader-grade UX.',
    tiers: [
      { key:'starter',  label:'Starter',  price:  349 },
      { key:'standard', label:'Standard', price:  799 },
      { key:'advanced', label:'Advanced', price: 1299 },
    ],
    addons: [
      { key:'fast',        label:'Fast Delivery',           price: 99  },
      { key:'extra_rev',   label:'Additional Revision',     price: 49  },
      { key:'branding',    label:'Branding & Theme Pack',   price: 150 },
      { key:'wallet',      label:'Wallet Layer (wagmi/viem)', price:200 },
      { key:'api',         label:'API/Data Integration',    price: 300 },
    ]
  },
  {
    key: 'web_rescue',
    title: 'Rapid Recovery: Site/Email • DNS/SSL/MX',
    tagline: 'Fix downtime • restore email • secure HTTPS',
    blurb: 'Triage + verified fix with proof (validation screenshots & tests).',
    tiers: [
      { key:'starter',  label:'Starter',  price:   60 },
      { key:'standard', label:'Standard', price:  160 },
      { key:'advanced', label:'Advanced', price:  320 },
    ],
    addons: [
      { key:'extra_rev',     label:'Additional Revision',         price: 24.99 },
      { key:'urgent4',       label:'Urgent 4-hour response',      price: 75    },
      { key:'cloudflare',    label:'Migrate DNS to Cloudflare',   price: 120   },
      { key:'email_migrate', label:'Email migration (Google/M365)', price: 250 },
    ]
  },
  {
    key: 'hubspot_email',
    title: 'HubSpot Email Template — Polished & Tested',
    tagline: 'Responsive • modules • bulletproof buttons',
    blurb: 'Hand-coded, table-based HTML with inline styles, retina images, and Litmus-tested tweaks.',
    tiers: [
      { key:'starter',  label:'Starter',  price:  49.99 },
      { key:'standard', label:'Standard', price: 119.99 },
      { key:'advanced', label:'Advanced', price: 349.99 },
    ],
    addons: [
      { key:'fast',       label:'Fast Delivery',         price: 85  },
      { key:'extra_rev',  label:'Additional Revision',   price: 29.99 },
      { key:'editable',   label:'Editable Template',     price: 85  },
      { key:'darkmode',   label:'Dark mode optimization',price: 45  },
      { key:'gif_hero',   label:'Animated GIF hero',     price: 65  },
      { key:'variant',    label:'Extra variant',         price: 75  },
    ]
  }
];

// helpful rounding
function round(n, step=1){ return Math.round(n/step)*step; }
function roundMoney(n){ return Math.round(n*100)/100; } // keep cents where used

function baseTierPrice(serviceKey, tierKey){
  const svc = HIRE_SERVICES.find(s=>s.key===serviceKey);
  const t = svc?.tiers.find(t=>t.key===tierKey);
  return t ? Number(t.price) : 0;
}
function addonsSum(serviceKey, addonKeys=[]){
  const svc = HIRE_SERVICES.find(s=>s.key===serviceKey);
  const map = new Map((svc?.addons||[]).map(a=>[a.key, Number(a.price)]));
  return (addonKeys||[]).reduce((s,k)=> s + (map.get(k)||0), 0);
}

function hireModifiersMultiplier(mod={}) {
  // urgency
  const u = (mod.urgency||'standard');
  let m = (u==='rush') ? 1.20 : (u==='ultra' ? 1.35 : 1.00);
  // complexity
  const c = (mod.complexity||'basic');
  m *= (c==='moderate') ? 1.12 : (c==='advanced' ? 1.25 : 1.00);
  return m;
}

async function aiHireAdjust(anchor, selection, mod){
  // Optional AI “nudge” ±10% based on stack/constraints if OpenAI is configured
  if (!OpenAIClient || !process.env.OPENAI_API_KEY) return anchor;
  try{
    const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
    const sys = 'You adjust quotes for software/game gigs. Given a base USD price, apply a small rational adjustment within ±10% based on risk and scope. Return ONLY a number.';
    const usr = `Base: ${anchor}. Service: ${selection.serviceKey}, Tier: ${selection.tierKey}, Addons: ${selection.addons?.join(',')||'none'}. Modifiers: ${JSON.stringify(mod)}.`;
    const r = await openai.chat.completions.create({ model: process.env.OPENAI_MODEL||'gpt-4o-mini', temperature:0.2, messages:[{role:'system',content:sys},{role:'user',content:usr}]});
    const txt = (r.choices?.[0]?.message?.content||'').trim();
    const val = Number(String(txt).replace(/[^\d.]/g,''));
    if (!isNaN(val) && val>0) return val;
  }catch(e){ /* silent */ }
  return anchor;
}

function priceEnvelope(anchor){
  const payNow = round(anchor * 0.95, 1);
  const deposit = Math.max(49, round(anchor * 0.20, 1));
  return { anchor: roundMoney(anchor), payNow: roundMoney(payNow), deposit: roundMoney(deposit), currency:'usd' };
}

// Compute single selection OR whole cart
async function computeHirePrice(payload={}){
  let sum = 0;
  const mod = payload.modifiers || {};
  if (payload.selection){
    const s = payload.selection;
    const base = baseTierPrice(s.serviceKey, s.tierKey) + addonsSum(s.serviceKey, s.addons);
    const withMods = base * hireModifiersMultiplier(mod);
    const adjusted = await aiHireAdjust(withMods, s, mod);
    sum += adjusted;
  } else if (Array.isArray(payload.cart)){
    for(const it of payload.cart){
      // cart items already include .amount (anchor) per selection,
      // but we still apply cart-level modifiers (urgency/complexity)
      sum += Number(it.amount) || 0;
    }
    sum *= hireModifiersMultiplier(mod);
    // small cart discount when buying multiple items
    if (payload.cart.length >= 3) sum *= 0.97;
  }
  return priceEnvelope(sum);
}

// Catalog
app.get('/api/hire/services', (req,res)=> res.json({ services: HIRE_SERVICES }));

// Quote (single selection OR whole cart)
app.post('/api/hire/quote', async (req,res)=>{
  try{
    const { selection=null, cart=null, modifiers={} } = req.body||{};
    const pricing = await computeHirePrice({ selection, cart, modifiers });
    const summary = selection
      ? `${selection.serviceKey} • ${selection.tierKey}${(selection.addons?.length? ' • +' + selection.addons.length + ' add-on(s)':'')}`
      : `Cart (${(cart||[]).length} item${(cart||[]).length===1?'':'s'})`;
    const breakdown = selection
      ? `Tier + add-ons × urgency/complexity`
      : `Sum of items × urgency/complexity`;
    res.json({ pricing, summary, breakdown });
  }catch(e){
    console.error('hire quote error', e.message);
    res.status(500).json({ error:'hire_quote_failed' });
  }
});

// Multi-item Stripe checkout
app.post('/api/hire/checkout', async (req,res)=>{
  try{
    const { items=[] } = req.body||{};
    if (!process.env.STRIPE_SECRET_KEY) return res.status(400).json({ error:'stripe_not_configured' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error:'no_items' });

    const line_items = items.map(it => ({
      price_data:{
        currency:'usd',
        unit_amount: Math.max(100, Math.round(Number(it.amountCents)||0)),
        product_data:{ name: String(it.label||'Service') }
      },
      quantity:1
    }));

    const session = await stripe.checkout.sessions.create({
      mode:'payment',
      payment_method_types:['card'],
      line_items,
      billing_address_collection:'required',
      success_url:`${process.env.PUBLIC_BASE_URL}/thank-you.html`,
      cancel_url:`${process.env.PUBLIC_BASE_URL}/hire.html?canceled=1`,
      metadata:{ source:'hire_shop' }
    });
    res.json({ url: session.url });
  }catch(e){
    console.error('hire checkout error', e.message);
    res.status(500).json({ error:'stripe_error', detail:e.message });
  }
});
/* ===================================================================== */


const app = express();
app.use(express.urlencoded({ extended: true })); // Twilio posts form-url-encoded
app.use(express.json());

// 👉 Serve the landing page & assets from /public
app.use(express.static(path.join(__dirname, 'public')));

// One canonical booking URL for the site + SMS
app.get('/book', (req, res) => {
  const url = process.env.CALENDLY_SCHEDULING_LINK || '';
  if (url) return res.redirect(url);     // 302 → your Calendly event
  return res.redirect('/checkout');      // fallback if env not set
});

// 1) Serve everything in /public (so /robots.txt, /favicon.ico work)
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'] // lets /dental resolve to index.html automatically
}));

// 2) Be explicit for /dental to be safe
app.use('/dental', express.static(path.join(__dirname, 'public', 'dental'), {
  extensions: ['html']
}));

// mount the API
app.use('/api/eligibility', require('./routes/eligibility'));

const BUSINESS = process.env.BUSINESS_NAME || 'Our Team';
const CAL_LINK = process.env.CALENDLY_SCHEDULING_LINK || '#';
const REVIEW_LINK = process.env.REVIEW_LINK || '';
const DIAL_TIMEOUT = parseInt(process.env.DIAL_TIMEOUT || '20', 10);

// Health
app.get('/health', (_, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------
// Front-end config (safe to expose PUBLISHABLE IDs only)
// ---------------------------------------------------------------------
app.get('/config', (_, res) => {
  res.json({
    stripePk: process.env.STRIPE_PUBLISHABLE_KEY || '',
    paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
    paypalPlanId: process.env.PAYPAL_PLAN_ID || '',
  });
});

// ✅ add these two lines near your other requires / app.use(...) calls
const eligibilityDXC = require('./routes/eligibility-dxc'); // no .js needed
app.use('/api/eligibility-dxc', eligibilityDXC);

// Register API routers
app.use('/api/eligibility', eligibilityDXC);




// ---------------------------------------------------------------------
// Stripe Checkout: subscription ($150/mo) + one-time setup ($300)
// Supports promo "DELCO150" via env STRIPE_COUPON_DELCO150
// ---------------------------------------------------------------------
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const promo = (req.body?.promo || '').trim().toUpperCase();

    const params = {
      mode: 'subscription',
      line_items: [
        { price: process.env.STRIPE_PRICE_SUB, quantity: 1 },   // $150/mo
        { price: process.env.STRIPE_PRICE_SETUP, quantity: 1 }, // $300 once
      ],
      allow_promotion_codes: true,
      success_url: `${process.env.APP_BASE_URL}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/checkout?canceled=1`,
    };

    if (promo === 'DELCO150' && process.env.STRIPE_COUPON_DELCO150) {
      params.discounts = [{ coupon: process.env.STRIPE_COUPON_DELCO150 }];
    }

    const session = await stripe.checkout.sessions.create(params);
    return res.json({ id: session.id });
  } catch (e) {
    console.error('Stripe session error:', e?.raw?.message || e?.message, e);
    return res.status(500).json({ error: 'stripe_error' });
  }
});

// Xbox 360 store: $5-per-game cart → Stripe Checkout
app.post('/api/store/checkout', async (req, res) => {
  try {
    const { items = [] } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'No items' });
    }

    const line_items = items.map(it => ({
      price_data: {
        currency: 'usd',
        unit_amount: Math.round((Number(it.price) || 5) * 100),
        product_data: {
          name: `${String(it.title || 'Xbox 360 Game').slice(0,120)} (Xbox 360)`,
          metadata: { sku: it.id || '' }
        }
      },
      quantity: 1
    }));

    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'link'],
      line_items,
      allow_promotion_codes: true,
      success_url: `${base}/thank-you?store=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${base}/x360.html?cancel=1`,
      metadata: { source: 'x360-store' }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('stripe store checkout error', err);
    res.status(500).json({ error: 'stripe_unavailable' });
  }
});


// Pretty routes for static pages
app.get('/checkout', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'checkout.html'))
);
app.get('/thank-you', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'thank-you.html'))
);

app.get('/x360', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'x360.html'))
);


// Demo eligibility endpoint (stub). Swap this logic for a real clearinghouse later.
app.post('/api/eligibility/check', async (req, res) => {
  try {
    const { payer, memberId, lastName, dob, zip } = req.body || {};
    // --- STUB LOGIC (for demo only) ---
    // Consider even last digit "eligible" to demo success/fail states.
    const ok = memberId && /\d$/.test(memberId);
    const eligible = ok ? (parseInt(memberId.slice(-1), 10) % 2 === 0) : false;

    return res.json({
      ok: true,
      eligible,
      planName: eligible ? `${(payer||'Dental PPO')}` : null,
      copayEstimate: eligible ? 30 : null, // demo number
      echo: { payer, lastName, dob, zip }   // for your inspection; remove later
    });
  } catch (e) {
    console.error('eligibility error', e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
});


// ---------------------------------------------------------------------
// 🔥 NEW: OpenAI chat endpoint
// ---------------------------------------------------------------------
// --- Chat endpoint (logs to JSONL & returns reply) ---
const fs = require('fs');
const { randomUUID } = require('crypto');

app.post('/api/chat', async (req, res) => {
  try {
    const convId = String(req.body?.convId || randomUUID());
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];

    // recent, trimmed history
    const history = incoming.slice(-10).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 2000),
    }));

    const systemPersona = `
You are "Mikey from Delco Tech" — a friendly, straight-shooting helper for HVAC & plumbing crews in Delaware County, PA.
Goals: explain briefly, then CLOSE. If the user shows buying intent (e.g., "yes", "sign me up", "ready", "buy", "activate"), respond with one short confirmation and include exactly one clear checkout link:
Checkout: ${(process.env.APP_BASE_URL || '')}/checkout
Also offer the 10-min setup call only if they ask for a call.
Keep replies 1–3 sentences, practical, Delco-casual unless they ask for details. Never say you're AI.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.6,
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPersona },
        ...history
      ],
    });

    const reply = completion.choices?.[0]?.message?.content || 'Got it.';

    // Append a JSON line for analytics / training later
    const logLine = {
      ts: new Date().toISOString(),
      convId,
      ip: req.headers['x-forwarded-for'] || req.ip || '',
      ua: req.headers['user-agent'] || '',
      lastUser: history[history.length - 1]?.content || '',
      reply
    };
    fs.appendFile('chatlogs.jsonl', JSON.stringify(logLine) + '\n', () => {});

    res.json({ reply, convId });
  } catch (err) {
    console.error('Chat error:', err?.message || err);
    res.status(500).json({ error: 'chat_error' });
  }
});


// ---------------------------------------------------------------------
// Twilio Voice: forward, then detect missed calls
// ---------------------------------------------------------------------
app.post('/voice', (req, res) => {
  const VoiceResponse = require('twilio').twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const dial = twiml.dial({ action: '/voice/after', timeout: DIAL_TIMEOUT });
  dial.number(process.env.FORWARD_TO_NUMBER);

  twiml.say('Sorry, we were unable to connect your call. We will text you shortly.');
  res.type('text/xml').send(twiml.toString());
});

app.post('/voice/after', async (req, res) => {
  const callStatus = req.body.DialCallStatus; // 'completed' | 'busy' | 'no-answer' | 'failed'
  const from = req.body.From;

  const VoiceResponse = require('twilio').twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());

  if (['busy', 'no-answer', 'failed'].includes(callStatus)) {
    setStep(from, 'ask_name');
    await upsertByPhone(from, { status: 'opened' });
    await sendSMS(
      from,
      `Hey, it's ${BUSINESS}. Sorry we missed your call. What's your name? ` +
      `Book anytime: ${CAL_LINK} — Reply STOP to stop, HELP for help.`
    );
  }
});

// ---------------------------------------------------------------------
// Twilio SMS: name -> need -> Calendly link
// ---------------------------------------------------------------------
app.post('/sms', async (req, res) => {
  const MessagingResponse = require('twilio').twiml.MessagingResponse;
  const twiml = new MessagingResponse();

  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const s = getState(from);

  if (/^help$/i.test(body)) {
    twiml.message(`Reply STOP to opt-out. To book directly: ${CAL_LINK}`);
    return res.type('text/xml').send(twiml.toString());
  }

  if (!s || !s.step) {
    setStep(from, 'ask_name');
    await upsertByPhone(from, { status: 'opened' });
    twiml.message(`Hey, it's ${BUSINESS}. What's your name?`);
    return res.type('text/xml').send(twiml.toString());
  }

  if (s.step === 'ask_name') {
    setField(from, 'name', body);
    setStep(from, 'ask_need');
    await upsertByPhone(from, { name: body, status: 'qualified' });
    twiml.message(`Nice to meet you, ${body}. What can we help you with?`);
    return res.type('text/xml').send(twiml.toString());
  }

  if (s.step === 'ask_need') {
    setField(from, 'need', body);
    setStep(from, 'book');
    await upsertByPhone(from, { need: body, status: 'qualified' });
    twiml.message(
      `Got it. You can book here: ${CAL_LINK}\n` +
      `If you prefer, reply with a preferred day/time and we’ll confirm by text.`
    );
    return res.type('text/xml').send(twiml.toString());
  }

  await upsertByPhone(from, { status: 'awaiting_booking' });
  twiml.message(`Thanks! We’ll confirm shortly. You can also self-book anytime: ${CAL_LINK}`);
  return res.type('text/xml').send(twiml.toString());
});

// ---------------------------------------------------------------------
// Calendly webhook → mark bookings / cancellations
// ---------------------------------------------------------------------
app.post('/calendly/webhook', async (req, res) => {
  try {
    const event = req.body?.event;
    const payload = req.body?.payload;
    if (!event || !payload) return res.status(400).json({ ok: false });

    if (event === 'invitee.created') {
      const phone = payload?.invitee?.text_reminder_number || '';
      const start = payload?.event?.start_time;
      const end = payload?.event?.end_time;
      const ev = payload?.event?.uri || '';
      if (phone) {
        await upsertByPhone(phone, {
          status: 'booked',
          appt_start: start || '',
          appt_end: end || '',
          calendly_event: ev || ''
        });
      }
    }

    if (event === 'invitee.canceled') {
      const phone = payload?.invitee?.text_reminder_number || '';
      if (phone) await upsertByPhone(phone, { status: 'canceled' });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('Calendly webhook error:', e);
    return res.status(500).json({ ok: false });
  }
});

// ---------------------------------------------------------------------
// Review request cron (every 5m, 2h after appt_end)
// ---------------------------------------------------------------------
cron.schedule('*/5 * * * *', async () => {
  try {
    if (!REVIEW_LINK) return;
    const rows = await findAll();
    const header = rows[0] || [];
    const idx = (name) => header.indexOf(name);

    const now = dayjs();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const phone = r[idx('phone')];
      const status = r[idx('status')];
      const apptEnd = r[idx('appt_end')];
      if (!phone || !apptEnd) continue;

      const due = now.isAfter(dayjs(apptEnd).add(2, 'hour'));
      const alreadySent = status && status.includes('review_sent');

      if (status === 'booked' && due && !alreadySent) {
        await sendSMS(phone, `Thanks for visiting ${BUSINESS}! Mind leaving a quick review? ${REVIEW_LINK}`);
        await upsertByPhone(phone, { status: 'review_sent' });
      }
    }
  } catch (e) {
    console.error('Review cron error:', e.message);
  }
});

// Simple health check (optional)
app.get('/api/health', async (req, res) => {
  try {
    // Optional: ping Stripe to confirm key works
    const ok = !!process.env.STRIPE_SECRET_KEY;
    res.json({ ok, stripe: ok, public: APP_BASE_URL });
  } catch {
    res.json({ ok: false, stripe: false, public: APP_BASE_URL });
  }
});

// Optional lightweight lead log so the front-end "begin_checkout" call doesn't 404
app.post('/api/lead', async (req, res) => {
  try {
    // You can persist to DB/Sheets/etc. For now just acknowledge.
    // console.log('lead:', req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'lead_store_failed' });
  }
});

/**
 * Dynamic one-time checkout
 * Expects: { amountCents, summary, partnerSlug?, rep?, dealId? }
 * Returns: { url }
 */
app.post('/api/deal/checkout/stripe', async (req, res) => {
  try {
    const { amountCents, summary = '', partnerSlug = '', rep = '', dealId = '' } = req.body || {};

    const amt = Number(amountCents) | 0;
    if (!amt || amt < 100) return res.status(400).json({ error: 'invalid_amount' });

    const name = String(summary).slice(0, 120) || 'Delco Tech — Custom Package';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'link'],
      allow_promotion_codes: true,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name },
          unit_amount: amt
        },
        quantity: 1
      }],
      success_url: `${APP_BASE_URL}/deal-thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/legal.html#packages`,
      metadata: { partnerSlug, rep, dealId }
    });

    return res.json({ url: session.url });
  } catch (e) {
    // console.error('checkout error', e);
    res.status(500).json({ error: 'checkout_failed' });
  }
});


// Dev: simulate a missed call
app.get('/simulate/missed-call', async (req, res) => {
  const from = req.query.from;
  if (!from) return res.status(400).json({ ok: false, error: 'from required' });

  setStep(from, 'ask_name');
  await upsertByPhone(from, { status: 'opened' });
  await sendSMS(
    from,
    `Hey, it's ${BUSINESS}. Sorry we missed your call. What's your name? ` +
    `Book anytime: ${CAL_LINK} — Reply STOP to stop, HELP for help.`
  );

  res.json({ ok: true });
});

// Boot
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Missed-Call Money Saver running on :${PORT}`);

  if (process.env.CALENDLY_TOKEN && process.env.APP_BASE_URL) {
    const cb = `${process.env.APP_BASE_URL}/calendly/webhook`;
    const r = await subscribeCalendlyWebhook(cb).catch(() => null);
    console.log(r?.ok ? 'Calendly webhook subscribed.' : 'Calendly webhook not subscribed (optional).');
  }
});
