const fs = require('fs');

const title = 'Missed Call Money Saver – How It Works';

function wrapParagraph(text, options = {}) {
  const width = options.width || 90;
  const prefix = options.prefix || '';
  const subsequentPrefix = options.subsequentPrefix || prefix;
  const words = text.trim().split(/\s+/);
  const lines = [];
  let current = prefix;
  let currentLen = prefix.length;
  const baseLen = prefix.length;

  for (const word of words) {
    const separator = currentLen > baseLen ? ' ' : '';
    if (currentLen + separator.length + word.length > width) {
      if (current.trim().length) lines.push(current);
      current = `${subsequentPrefix}${word}`;
      currentLen = current.length;
    } else {
      current += `${separator}${word}`;
      currentLen = current.length;
    }
  }

  if (current.trim().length) lines.push(current);
  if (!lines.length) lines.push(prefix.trim());
  return lines;
}

const sections = [
  { heading: 'Call Flow Overview', body: [
    'When someone dials your Twilio number, the Express server immediately creates a TwiML Dial verb that forwards the call to your real business line. The timeout is controlled by the DIAL_TIMEOUT environment variable so you can decide how long to ring before failing over.',
    'After the dial attempt finishes, Twilio posts back to /voice/after with the final status. If the status indicates the call was not answered (busy, no-answer, or failed), the app kicks off the SMS follow-up workflow.'
  ]},
  { heading: 'Automatic SMS Concierge', body: [
    'The /sms endpoint uses a lightweight state machine stored in lib/leadStore.js to remember each caller. The first message asks for their name, the second asks what they need, and the third shares your Calendly scheduling link. Every reply is also written to Google Sheets so your team can see the lead history instantly.',
    'Built-in responses make it compliant: the bot accepts HELP to reiterate commands and STOP to opt out automatically. If a lead keeps texting after the booking link is sent, they receive a friendly confirmation and another copy of the self-service booking link.'
  ]},
  { heading: 'Lead Logging in Google Sheets', body: [
    'The services/sheets.js helper connects with the Google Sheets API using a service account. Each interaction calls upsertByPhone to insert or update a row keyed by the caller\'s phone number. It tracks fields like timestamp, name, stated need, status, appointment start and end times, and the Calendly event URI so your team has a single source of truth.'
  ]},
  { heading: 'Calendly + Review Automation', body: [
    'When you provide a Calendly API token, the server subscribes to webhook events at /calendly/webhook. A new booking flips the lead status to booked and logs the appointment window; cancellations mark the row as canceled.',
    'A cron job runs every five minutes. Two hours after an appointment end time it will text the lead a customizable review link and update the Sheet so you never send duplicate reminders.'
  ]},
  { heading: 'Web Experience & Payments', body: [
    'The Express app also serves the marketing site from /public and exposes helper APIs. /config shares publishable Stripe and PayPal keys with the browser, /api/create-checkout-session handles the $150/mo subscription plus one-time setup fee, and optional store routes demonstrate how to sell add-on products through Stripe Checkout.',
    'Front-end pages like /checkout and /thank-you are static HTML files, making it easy to host the whole stack on a single Node process or behind a platform like Render, Fly.io, or Railway.'
  ]},
  { heading: 'AI Assistants for Sales Teams', body: [
    'Two OpenAI-powered endpoints give your team superpowers. /api/chat lets prospects chat with “Mikey from Delco Tech,” a persona tuned to close deals and drop your checkout link when someone is ready to buy. /api/real-estate-script drafts personalized cold-call scripts for acquisitions teams when you supply tone, market focus, and desired call-to-action.'
  ]},
  { heading: 'Launch Checklist', body: [
    '1) Install dependencies with npm install. 2) Copy .env.example to .env and fill in the required credentials for Twilio, Google Sheets, Stripe, Calendly, and any optional integrations. 3) Run npm run start locally or deploy to your preferred host. 4) Use ngrok or your production domain to configure Twilio webhooks for /voice and /sms. 5) Place a test call, walk through the SMS prompts, and confirm the Google Sheet updates before going live.'
  ]}
];

const lines = [];

for (const section of sections) {
  lines.push(section.heading.toUpperCase());
  for (const paragraph of section.body) {
    lines.push(null);
    const isChecklist = /^\d\)/.test(paragraph.trim());
    if (isChecklist) {
      const parts = paragraph.split(/\s*\d\)\s*/).filter(Boolean);
      parts.forEach((item, idx) => {
        const text = `${idx + 1}) ${item.trim()}`;
        wrapParagraph(text, { prefix: '', subsequentPrefix: '' }).forEach(line => lines.push(line));
      });
    } else {
      wrapParagraph(paragraph, { prefix: '', subsequentPrefix: '' }).forEach(line => lines.push(line));
    }
    lines.push(null);
  }
  lines.push(null);
}

function escapePdf(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r/g, '').replace(/\n/g, ' ');
}

const streamCommands = [];
streamCommands.push('BT');
streamCommands.push('/F1 18 Tf');
streamCommands.push('1 0 0 1 72 770 Tm');
streamCommands.push(`(${escapePdf(title)}) Tj`);
streamCommands.push('/F1 12 Tf');
streamCommands.push('16 TL');
streamCommands.push('0 -36 Td');

let firstLine = true;
let pendingBlank = false;

for (const line of lines) {
  if (line === null) {
    pendingBlank = true;
    continue;
  }
  if (firstLine) {
    streamCommands.push(`(${escapePdf(line)}) Tj`);
    firstLine = false;
    pendingBlank = false;
    continue;
  }
  if (pendingBlank) {
    streamCommands.push('T*');
    pendingBlank = false;
  }
  streamCommands.push('T*');
  streamCommands.push(`(${escapePdf(line)}) Tj`);
}

streamCommands.push('ET');

const streamContent = streamCommands.join('\n');
const streamLength = Buffer.byteLength(streamContent, 'utf8');

const objects = [
  { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
  { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
  { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>' },
  { id: 4, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  { id: 5, body: `<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream` }
];

let pdf = '%PDF-1.4\n';
const offsets = [0];

for (const obj of objects) {
  offsets.push(pdf.length);
  pdf += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
}

const xrefOffset = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';

for (let i = 1; i < offsets.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
}

pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\n`;
pdf += `startxref\n${xrefOffset}\n%%EOF`;

fs.writeFileSync('docs/how-it-works.pdf', pdf, 'binary');
console.log('Wrote docs/how-it-works.pdf');