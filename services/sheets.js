require('dotenv').config();
const { google } = require('googleapis');
const dayjs = require('dayjs');

const sheets = google.sheets('v4');
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const RANGE = 'Sheet1!A:H'; // adjust if your tab name differs

async function appendRow(row) {
  const authClient = await auth.getClient();
  await sheets.spreadsheets.values.append({
    auth: authClient,
    spreadsheetId: SHEET_ID,
    range: RANGE,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });
}

async function findAll() {
  const authClient = await auth.getClient();
  const res = await sheets.spreadsheets.values.get({
    auth: authClient,
    spreadsheetId: SHEET_ID,
    range: RANGE
  });
  return res.data.values || [];
}

async function upsertByPhone(phone, patch) {
  // Load all rows; find row with phone; update or append
  const authClient = await auth.getClient();
  const res = await sheets.spreadsheets.values.get({
    auth: authClient,
    spreadsheetId: SHEET_ID,
    range: RANGE
  });
  const rows = res.data.values || [];
  const header = rows[0] || [];
  const phoneIdx = header.indexOf('phone');

  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

  if (rows.length === 0) {
    // Write header first time
    await sheets.spreadsheets.values.update({
      auth: authClient,
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A1:H1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          'timestamp','phone','name','need','status','appt_start','appt_end','calendly_event'
        ]]
      }
    });
  }

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][phoneIdx] === phone) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex === -1) {
    // Append new
    await appendRow([
      now,
      phone,
      patch.name || '',
      patch.need || '',
      patch.status || 'opened',
      patch.appt_start || '',
      patch.appt_end || '',
      patch.calendly_event || ''
    ]);
  } else {
    // Update in place
    const row = rows[rowIndex];
    const cols = {
      timestamp: 0,
      phone: 1,
      name: 2,
      need: 3,
      status: 4,
      appt_start: 5,
      appt_end: 6,
      calendly_event: 7
    };
    const newRow = [
      row[cols.timestamp] || now,
      row[cols.phone] || phone,
      patch.name ?? row[cols.name] ?? '',
      patch.need ?? row[cols.need] ?? '',
      patch.status ?? row[cols.status] ?? 'opened',
      patch.appt_start ?? row[cols.appt_start] ?? '',
      patch.appt_end ?? row[cols.appt_end] ?? '',
      patch.calendly_event ?? row[cols.calendly_event] ?? ''
    ];

    const range = `Sheet1!A${rowIndex + 1}:H${rowIndex + 1}`;
    await sheets.spreadsheets.values.update({
      auth: authClient,
      spreadsheetId: SHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] }
    });
  }
}

module.exports = { appendRow, upsertByPhone, findAll };
