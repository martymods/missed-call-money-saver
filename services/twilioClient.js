require('dotenv').config();
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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

  const attemptLog = {
    timestamp: new Date().toISOString(),
    to,
    usingMessagingService: Boolean(process.env.MESSAGING_SERVICE_SID),
    from: payload.from || null,
    context,
    bodyPreview: redactBody(body, 160),
  };
  console.info('[SMS] Attempting to send message', attemptLog);

  try {
    const message = await client.messages.create(payload);
    console.info('[SMS] Message queued', {
      timestamp: new Date().toISOString(),
      sid: message?.sid,
      status: message?.status,
      to: message?.to,
      from: message?.from,
      messagingServiceSid: message?.messagingServiceSid || payload.messagingServiceSid || null,
      context,
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
      payload: { ...payload, body: redactBody(payload.body) },
      context,
    });
    throw error;
  }
}

module.exports = { client, sendSMS };
