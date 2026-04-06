import type { ContactDraft } from "./contactParser";

export type SavedContactEntry = {
  id: string;
  savedAt: string;
  source: string;
  draft: ContactDraft;
};

export function buildSavedContact(
  draft: ContactDraft,
  source: string,
  createFollowUp: boolean
): SavedContactEntry {
  const savedAt = new Date().toISOString();
  const notes = createFollowUp
    ? [draft.notes, `Follow up requested on ${formatDateLabel(savedAt)}.`].filter(Boolean).join(" | ")
    : draft.notes;

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt,
    source,
    draft: {
      ...draft,
      notes
    }
  };
}

export function createContactSummary(draft: ContactDraft) {
  return [
    draft.fullName,
    draft.title ? `${draft.title}${draft.company ? `, ${draft.company}` : ""}` : draft.company,
    draft.mobilePhone ? `Mobile: ${draft.mobilePhone}` : "",
    draft.officePhone ? `Office: ${draft.officePhone}` : "",
    draft.email ? `Email: ${draft.email}` : "",
    draft.website ? `Website: ${draft.website}` : "",
    draft.address ? `Address: ${draft.address}` : "",
    draft.notes ? `Notes: ${draft.notes}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function createVCard(draft: ContactDraft) {
  const [firstName, ...remaining] = draft.fullName.trim().split(/\s+/);
  const lastName = remaining.join(" ");

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCardValue(lastName)};${escapeVCardValue(firstName)};;;`,
    `FN:${escapeVCardValue(draft.fullName || draft.company || "Business Card Contact")}`
  ];

  if (draft.company) {
    lines.push(`ORG:${escapeVCardValue(draft.company)}`);
  }

  if (draft.title) {
    lines.push(`TITLE:${escapeVCardValue(draft.title)}`);
  }

  if (draft.mobilePhone) {
    lines.push(`TEL;TYPE=CELL:${escapeVCardValue(draft.mobilePhone)}`);
  }

  if (draft.officePhone) {
    lines.push(`TEL;TYPE=WORK:${escapeVCardValue(draft.officePhone)}`);
  }

  if (draft.email) {
    lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardValue(draft.email)}`);
  }

  if (draft.website) {
    lines.push(`URL:${escapeVCardValue(draft.website)}`);
  }

  if (draft.address) {
    lines.push(`ADR;TYPE=WORK:;;${escapeVCardValue(draft.address)};;;;`);
  }

  if (draft.notes) {
    lines.push(`NOTE:${escapeVCardValue(draft.notes)}`);
  }

  lines.push("END:VCARD");
  return `${lines.join("\n")}\n`;
}

export function getPrimaryLabel(draft: ContactDraft) {
  return draft.fullName || draft.company || "Untitled contact";
}

export function formatDateLabel(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function escapeVCardValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
