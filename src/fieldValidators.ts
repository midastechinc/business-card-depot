export const ADDRESS_WORDS = [
  "street",
  "st",
  "road",
  "rd",
  "avenue",
  "ave",
  "boulevard",
  "blvd",
  "drive",
  "dr",
  "suite",
  "unit",
  "floor",
  "court",
  "way",
  "plaza",
  "canada",
  "ontario",
  "alberta",
  "quebec"
];

export function normalizeComparable(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function dedupeTextValues(values: Array<string | undefined | null>) {
  const seen = new Set<string>();
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).filter(value => {
    const normalized = normalizeComparable(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function normalizePhoneValue(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  const cleaned = value.replace(/\s+/g, " ").trim();
  return digits.length > 0 ? cleaned : "";
}

export function isValidEmail(value: string) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value.trim());
}

export function normalizeEmailValue(value: string) {
  const trimmed = value.trim().toLowerCase();
  return isValidEmail(trimmed) ? trimmed : "";
}

export function isValidWebsite(value: string) {
  return /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(value.trim());
}

export function normalizeWebsiteValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!isValidWebsite(trimmed)) return "";
  return trimmed.replace(/^https?:\/\//i, "");
}

export function isValidPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 12;
}

export function normalizeAcceptedPhoneValue(value: string) {
  const normalized = normalizePhoneValue(value);
  return isValidPhone(normalized) ? normalized : "";
}

export function extractWebsiteFromText(value: string) {
  const matches = value.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?/gi) ?? [];
  return matches.find(candidate => !candidate.includes("@")) ?? "";
}

export function looksGeoSpecificValue(value: string) {
  return /\b(canada|usa|ontario|alberta|quebec|toronto|vancouver|richmond hill)\b/i.test(value) || /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(value);
}

export function looksLikeAddressValue(value: string) {
  const lower = value.toLowerCase();
  return /\d/.test(value) && (
    ADDRESS_WORDS.some(word => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(value)) ||
    /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(value) ||
    /\b[a-z]+,\s*[a-z]+\b/i.test(lower)
  );
}

export function looksLikeAddressContinuationValue(value: string) {
  return looksLikeAddressValue(value) || looksGeoSpecificValue(value);
}

export function normalizeAddressValue(value: string) {
  const trimmed = value
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(,\s*){2,}/g, ", ")
    .trim()
    .replace(/,\s*$/, "");

  return looksLikeAddressValue(trimmed) || looksGeoSpecificValue(trimmed) ? trimmed : "";
}

export function cleanOcrTextLine(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[•·]/g, " ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\bwww\s+/gi, "www.")
    .replace(/\s*@\s*/g, "@")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/[|]{2,}/g, "|")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
