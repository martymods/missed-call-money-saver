const fetch = global.fetch || require('node-fetch');

function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function sendTelegramMessage(text, options = {}) {
  if (!isTelegramConfigured()) {
    return {
      ok: false,
      skipped: true,
      reason: 'telegram_not_configured',
    };
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;
  const payload = {
    chat_id: chatId,
    text: String(text ?? '').slice(0, 3500) || ' ',
    disable_web_page_preview: true,
  };

  if (options.parseMode) {
    payload.parse_mode = options.parseMode;
  }

  const requestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  };

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(url, requestInit);
  let data = null;

  try {
    data = await response.json();
  } catch (error) {
    // ignore parse errors; Telegram should always return JSON
  }

  if (!response.ok || !data?.ok) {
    const error = new Error('Failed to send Telegram message');
    error.status = response.status;
    error.response = data;
    throw error;
  }

  return {
    ok: true,
    result: data?.result || null,
  };
}

module.exports = {
  isTelegramConfigured,
  sendTelegramMessage,
};
