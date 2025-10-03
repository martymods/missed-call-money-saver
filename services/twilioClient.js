require('dotenv').config();
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function maskPhone(value) {
  if (!value) {
    return value;
  }
  const str = String(value).trim();
  if (!str) {
    return str;
  }
  const digitsOnly = str.replace(/[^\d]/g, '');
  if (digitsOnly.length <= 4) {
    return str;
  }
  const suffix = digitsOnly.slice(-4);
  const hasPlus = str.startsWith('+');
  return `${hasPlus ? '+' : ''}***${suffix}`;
}

function maskContext(context = {}) {
  if (!context || typeof context !== 'object') {
    return context;
  }
  const result = { ...context };
  if ('to' in result) {
    result.to = maskPhone(result.to);
  }
  if ('from' in result) {
    result.from = maskPhone(result.from);
  }
  if ('originalTo' in result) {
    result.originalTo = maskPhone(result.originalTo);
  }
  return result;
}

function redactBody(value, max = 320) {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}… (${value.length - max} more chars)`;
}

async function sendSMS(to, body, context = {}) {
  const payload = { to, body };
  if (process.env.MESSAGING_SERVICE_SID) {
    payload.messagingServiceSid = process.env.MESSAGING_SERVICE_SID;
  } else {
    payload.from = process.env.TWILIO_NUMBER;
  }

  const safePayload = {
    ...payload,
    to: maskPhone(payload.to),
    from: maskPhone(payload.from),
  };

  const attemptLog = {
    timestamp: new Date().toISOString(),
    to: maskPhone(to),
    usingMessagingService: Boolean(process.env.MESSAGING_SERVICE_SID),
    from: maskPhone(payload.from || null),
    context: maskContext(context),
    bodyPreview: redactBody(body, 160),
  };
  console.info('[SMS] Attempting to send message', attemptLog);

  try {
    const message = await client.messages.create(payload);
    console.info('[SMS] Message queued', {
      timestamp: new Date().toISOString(),
      sid: message?.sid,
      status: message?.status,
      to: maskPhone(message?.to),
      from: maskPhone(message?.from),
      messagingServiceSid: message?.messagingServiceSid || payload.messagingServiceSid || null,
      context: maskContext(context),
    });
    return message;
  } catch (error) {
    console.error('[SMS] Message failed', {
      timestamp: new Date().toISOString(),
      error: {
        message: error?.message,
        code: error?.code,
        status: error?.status,
        moreInfo: error?.moreInfo,
      },
      payload: { ...safePayload, body: redactBody(payload.body) },
      context: maskContext(context),
    });
    throw error;
  }
}

module.exports = { client, sendSMS };
