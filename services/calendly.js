require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

async function subscribeCalendlyWebhook(callbackUrl) {
  const token = process.env.CALENDLY_TOKEN;
  if (!token) return { ok: false, reason: 'No CALENDLY_TOKEN set' };

  const res = await fetch('https://api.calendly.com/webhook_subscriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: callbackUrl,
      events: ['invitee.created', 'invitee.canceled'],
      organization: null, // user-level
      scope: 'user'
    })
  });

  const data = await res.json();
  return { ok: res.ok, data };
}

module.exports = { subscribeCalendlyWebhook };
