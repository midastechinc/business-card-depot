import type { SavedContactEntry } from "./contactActions";

export async function syncSavedContactToList(savedEntry: SavedContactEntry, listDatabaseUrl: string) {
  const targetUrl = listDatabaseUrl.trim();
  if (!targetUrl) {
    throw new Error("Enter a valid list database URL first.");
  }

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sourceApp: "Business Card Depot",
      savedAt: savedEntry.savedAt,
      source: savedEntry.source,
      contact: savedEntry.draft
    })
  });

  if (!response.ok) {
    throw new Error(`List sync failed with status ${response.status}.`);
  }

  return response;
}
