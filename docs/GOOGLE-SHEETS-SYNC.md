# Google Sheets Sync

`Business Card Depot` can optionally push each saved contact into Google Sheets by calling a Google Apps Script web app.

## What The App Sends

When Google Sheets sync is enabled, the app sends a `POST` request with JSON like:

```json
{
  "sourceApp": "Business Card Depot",
  "savedAt": "2026-04-06T22:15:00.000Z",
  "source": "Import image",
  "contact": {
    "fullName": "Jane Smith",
    "company": "Midas Tech",
    "title": "Sales Director",
    "mobilePhone": "(555) 555-1111",
    "officePhone": "(555) 555-2222",
    "email": "jane@example.com",
    "website": "https://example.com",
    "address": "123 Main St, Toronto, Ontario",
    "notes": "Imported from a saved card image."
  }
}
```

## Recommended Sheet Columns

Create a Google Sheet with columns like:

- `Saved At`
- `Source`
- `Full Name`
- `Company`
- `Title`
- `Mobile Phone`
- `Office Phone`
- `Email`
- `Website`
- `Address`
- `Notes`

## Apps Script Example

Open the Google Sheet, then use `Extensions -> Apps Script` and add:

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Contacts');
  const payload = JSON.parse(e.postData.contents);
  const contact = payload.contact || {};

  sheet.appendRow([
    payload.savedAt || '',
    payload.source || '',
    contact.fullName || '',
    contact.company || '',
    contact.title || '',
    contact.mobilePhone || '',
    contact.officePhone || '',
    contact.email || '',
    contact.website || '',
    contact.address || '',
    contact.notes || ''
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Deploy

1. Click `Deploy -> New deployment`
2. Choose `Web app`
3. Set access to a mode your phone/app can reach
4. Copy the deployed `Web app URL`
5. Paste that URL into the app's `Admin -> Google Sheets webhook URL`

## In The App

1. Open `Admin`
2. Turn on `Sync saved cards to Google Sheets`
3. Paste the Apps Script Web App URL
4. Tap `Send test payload`
5. Save a card and confirm the row appears in your sheet
