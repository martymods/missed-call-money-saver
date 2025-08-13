require('dotenv').config();
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendSMS(to, body) {
  const payload = { to, body };
  if (process.env.MESSAGING_SERVICE_SID) {
    payload.messagingServiceSid = process.env.MESSAGING_SERVICE_SID;
  } else {
    payload.from = process.env.TWILIO_NUMBER;
  }
  return client.messages.create(payload);
}

module.exports = { client, sendSMS };
