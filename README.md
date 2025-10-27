# missed-call-money-saver

## Quick Start

1) `npm i`

2) Copy `.env.example` → `.env` and fill values.

3) Google Sheets
   - Create a new Sheet. Row 1: `timestamp | phone | name | need | status | appt_start | appt_end | calendly_event`
   - Enable Google Sheets API in Google Cloud.
   - Create a **Service Account**, download JSON → `credentials/service-account.json`
   - Share the Sheet with the service account email (Editor).

4) Twilio
   - Buy a number with Voice + SMS.
   - Set **Voice webhook** (POST) to: `https://YOUR_DOMAIN/voice`
   - Set **Messaging webhook** (POST) to: `https://YOUR_DOMAIN/sms`
   - In `.env`, set `TWILIO_NUMBER`, `FORWARD_TO_NUMBER`.

5) ElevenLabs voice + fallback
   - Put your ElevenLabs API key in `.env` as `ELEVENLABS_API_KEY` and optional voice IDs.
   - (Optional) Add `OPENAI_API_KEY` to enable automatic OpenAI TTS fallback if ElevenLabs quota is exceeded.

6) Calendly (optional)
   - Put your personal scheduling link in `.env` as `CALENDLY_SCHEDULING_LINK`.
   - To auto-mark bookings + send review SMS, create a Personal Access Token and put it in `.env` as `CALENDLY_TOKEN`.
   - The server will attempt to subscribe to a webhook at `/calendly/webhook` on boot.

7) Local dev
   - Run `npm run start`
   - Use `ngrok http 3000`, set APP_BASE_URL to your ngrok URL, and update Twilio webhooks to point there.

8) Test
   - Call your Twilio number from your phone; let it ring out → you should get an SMS.
   - Or GET `/simulate/missed-call?from=+1YYYYYYYYYY`
   - Reply with your name → bot asks your need → bot replies with your Calendly link.
   - Check your Google Sheet for rows appearing/updated.

9) Telegram order alerts
   - Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to your environment (Render → Dashboard → Environment).
   - Deploy the server (or run locally) and visit `/api/notifications/telegram/test?message=Hello%20from%20Delco` to confirm you receive the ping.
   - Once configured, every Stripe Checkout session or Payment Intent created by the app will automatically push a summary (including delivery notes when available) to your chat.
