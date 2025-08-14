require('dotenv').config();
const express = require('express');
const dayjs = require('dayjs');
const cron = require('node-cron');
const path = require('path'); // ✅ NEW
const { sendSMS } = require('./services/twilioClient');
const { upsertByPhone, findAll } = require('./services/sheets');
const { subscribeCalendlyWebhook } = require('./services/calendly');
const { setStep, setField, get: getState, reset } = require('./lib/leadStore');

const app = express();
app.use(express.urlencoded({ extended: true })); // Twilio posts form-url-encoded
app.use(express.json());

// ✅ NEW: serve the landing page (and any other assets) from /public at the site root
app.use(express.static(path.join(__dirname, 'public')));

const BUSINESS = process.env.BUSINESS_NAME || 'Our Team';
const CAL_LINK = process.env.CALENDLY_SCHEDULING_LINK;
const REVIEW_LINK = process.env.REVIEW_LINK;
const DIAL_TIMEOUT = parseInt(process.env.DIAL_TIMEOUT || '20', 10);

// Health
app.get('/health', (_, res) => res.json({ ok: true }));

// ─────────────────────────────────────────────────────────────
// Twilio Voice: initial webhook when call comes in
// Responds with TwiML to forward call to real number, with timeout.
// After <Dial>, Twilio posts to /voice/after with DialCallStatus.
// ─────────────────────────────────────────────────────────────
app.post('/voice', (req, res) => {
  const VoiceResponse = require('twilio').twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const dial = twiml.dial({
    action: '/voice/after',
    timeout: DIAL_TIMEOUT
  });
  dial.number(process.env.FORWARD_TO_NUMBER);

  // Backup message if forwarding fails entirely
  twiml.say('Sorry, we were unable to connect your call. We will text you shortly.');

  res.type('text/xml').send(twiml.toString());
});

// After Dial: decide missed vs answered
app.post('/voice/after', async (req, res) => {
  const callStatus = req.body.DialCallStatus; // 'completed' | 'busy' | 'no-answer' | 'failed'
  const from = req.body.From;

  // Always reply TwiML to close out
  const VoiceResponse = require('twilio').twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());

  if (['busy','no-answer','failed'].includes(callStatus)) {
    // Start SMS flow
    setStep(from, 'ask_name');
    await upsertByPhone(from, { status: 'opened' });
    await sendSMS(
      from,
      `Hey, it's ${BUSINESS}. Sorry we missed your call. What's your name? ` +
      `Book anytime: ${CAL_LINK} — Reply STOP to stop, HELP for help.`
    );
  }
});

// ─────────────────────────────────────────────────────────────
// Twilio SMS: conversation flow (name -> need -> calendly link)
// ─────────────────────────────────────────────────────────────
app.post('/sms', async (req, res) => {
  const MessagingResponse = require('twilio').twiml.MessagingResponse;
  const twiml = new MessagingResponse();

  const from = req.body.From;
  const body = (req.body.Body || '').trim();

  const s = getState(from);

  // Handle STOP/HELP quickly
  if (/^help$/i.test(body)) {
    twiml.message(`Reply STOP to opt-out. To book directly: ${CAL_LINK}`);
    return res.type('text/xml').send(twiml.toString());
  }

  if (!s || !s.step) {
    // Fresh conversation (eg they texted first)
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

  if (s.step === 'book') {
    // They might paste a time; just acknowledge and keep status
    await upsertByPhone(from, { status: 'awaiting_booking' });
    twiml.message(`Thanks! We’ll confirm shortly. You can also self-book anytime: ${CAL_LINK}`);
    return res.type('text/xml').send(twiml.toString());
  }

  // fallback
  twiml.message(`You can book here: ${CAL_LINK}`);
  return res.type('text/xml').send(twiml.toString());
});

// ─────────────────────────────────────────────────────────────
// Calendly webhook (optional): mark bookings + schedule reviews
// ─────────────────────────────────────────────────────────────
app.post('/calendly/webhook', async (req, res) => {
  try {
    const event = req.body?.event;
    const payload = req.body?.payload;

    if (!event || !payload) return res.status(400).json({ ok: false });

    if (event === 'invitee.created') {
      const phone = payload?.invitee?.text_reminder_number || ''; // may be undefined
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
      if (phone) {
        await upsertByPhone(phone, { status: 'canceled' });
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('Calendly webhook error:', e);
    return res.status(500).json({ ok: false });
  }
});

// ─────────────────────────────────────────────────────────────
/* Simple scheduler to send review SMS after appointments end
   Runs every 5 minutes; if appt_end < now and status=booked -> send review, mark review_sent */
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
      const calendlyEvent = r[idx('calendly_event')];

      if (!phone || !apptEnd) continue;

      const end = dayjs(apptEnd);
      const due = now.isAfter(end.add(2, 'hour')); // send 2h after
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

// ─────────────────────────────────────────────────────────────
// (Dev) Simulate a missed call
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Missed-Call Money Saver running on :${PORT}`);

  // Try to auto-subscribe Calendly webhook if configured
  if (process.env.CALENDLY_TOKEN && process.env.APP_BASE_URL) {
    const cb = `${process.env.APP_BASE_URL}/calendly/webhook`;
    const r = await subscribeCalendlyWebhook(cb).catch(() => null);
    if (r?.ok) console.log('Calendly webhook subscribed.');
    else console.log('Calendly webhook not subscribed (optional).');
  }
});
