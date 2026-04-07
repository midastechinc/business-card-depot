import type { SavedContactEntry } from "./contactActions";

export async function syncSavedContactToGoogleSheets(savedEntry: SavedContactEntry, webhookUrl: string) {
  const targetUrl = webhookUrl.trim();
  if (!targetUrl) {
    throw new Error("Enter a valid Google Sheets webhook URL first.");
  }

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      sourceApp: "Business Card Depot",
      savedAt: savedEntry.savedAt,
      source: savedEntry.source,
      contact: savedEntry.draft
    })
  });

  if (!response.ok) {
    throw new Error(`Google Sheets sync failed with status ${response.status}.`);
  }

  return response;
}
