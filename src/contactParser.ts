export type ContactDraft = {
  fullName: string;
  company: string;
  title: string;
  mobilePhone: string;
  officePhone: string;
  email: string;
  website: string;
  address: string;
  notes: string;
};

export type ContactField = keyof ContactDraft;

export type ParsedContactResult = {
  draft: ContactDraft;
  fieldConfidence: Record<ContactField, "high" | "medium" | "low">;
  lines: string[];
};

export const emptyDraft: ContactDraft = {
  fullName: "",
  company: "",
  title: "",
  mobilePhone: "",
  officePhone: "",
  email: "",
  website: "",
  address: "",
  notes: ""
};

type LineRecord = {
  cleaned: string;
  lower: string;
  index: number;
};

type FieldCandidate = {
  value: string;
  confidence: "high" | "medium" | "low";
};

const TITLE_WORDS = [
  "director",
  "manager",
  "president",
  "owner",
  "advisor",
  "specialist",
  "consultant",
  "developer",
  "coordinator",
  "sales",
  "business",
  "founder",
  "marketing",
  "account",
  "operations",
  "executive",
  "engineer",
  "associate",
  "representative"
];

const COMPANY_WORDS = [
  "inc",
  "corp",
  "group",
  "solutions",
  "advisory",
  "consulting",
  "ltd",
  "llc",
  "company",
  "studio",
  "systems",
  "technologies",
  "lexus",
  "toyota",
  "honda",
  "ford",
  "auto",
  "motors",
  "dealership"
];

export function parseContactFromText(text: string): ParsedContactResult {
  const normalized = text.replace(/\r/g, "");
  const lines = normalized
    .split("\n")
    .map((line, index) => toLineRecord(line, index))
    .filter(line => line.cleaned);

  const email = createCandidate(firstMatch(normalized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i), "high");
  const website = createCandidate(extractWebsite(normalized), "medium");
  const phones = extractPhones(lines);

  const fullName = findBestName(lines);
  const title = findBestTitle(lines, fullName.value);
  const company = findBestCompany(lines, fullName.value, title.value);
  const address = findBestAddress(lines, email.value, website.value, phones.mobile.value, phones.office.value);

  const notesValue = buildNotes(lines, [
    fullName.value,
    company.value,
    title.value,
    email.value,
    website.value,
    address.value,
    phones.mobile.value,
    phones.office.value
  ]);

  return {
    draft: {
      fullName: fullName.value,
      company: company.value,
      title: title.value,
      mobilePhone: phones.mobile.value,
      officePhone: phones.office.value,
      email: email.value,
      website: website.value,
      address: address.value,
      notes: notesValue
    },
    fieldConfidence: {
      fullName: fullName.confidence,
      company: company.confidence,
      title: title.confidence,
      mobilePhone: phones.mobile.confidence,
      officePhone: phones.office.confidence,
      email: email.confidence,
      website: website.confidence,
      address: address.confidence,
      notes: notesValue ? "medium" : "low"
    },
    lines: lines.map(line => line.cleaned)
  };
}

function createCandidate(value: string, confidence: "high" | "medium" | "low"): FieldCandidate {
  return { value, confidence: value ? confidence : "low" };
}

function toLineRecord(value: string, index: number): LineRecord {
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/[|]+/g, " | ")
    .trim();

  return {
    cleaned,
    lower: cleaned.toLowerCase(),
    index
  };
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[0] ?? "";
}

function extractWebsite(value: string) {
  const matches = value.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?/gi) ?? [];
  return matches.find(candidate => !candidate.includes("@")) ?? "";
}

function extractPhones(lines: LineRecord[]) {
  const phoneMatches = lines
    .map(line => {
      const matched = line.cleaned.match(/(?:\+\d{1,2}\s*)?(?:\(?\d{3}\)?[\s./-]*)\d{3}[\s./-]*\d{4}/g) ?? [];
      return { line, matched };
    })
    .filter(item => item.matched.length > 0);

  let mobile = "";
  let office = "";
  let mobileConfidence: "high" | "medium" | "low" = "low";
  let officeConfidence: "high" | "medium" | "low" = "low";

  for (const item of phoneMatches) {
    const first = item.matched[0] ?? "";

    if (!mobile && /\b(cell|mobile|direct)\b/i.test(item.line.cleaned)) {
      mobile = first;
      mobileConfidence = "high";
      continue;
    }

    if (!office && /\b(main|office|tel|phone|ext)\b/i.test(item.line.cleaned)) {
      office = first;
      officeConfidence = "high";
      continue;
    }
  }

  const all = phoneMatches.flatMap(item => item.matched);
  if (!office) {
    office = all[0] ?? "";
    officeConfidence = office ? "medium" : "low";
  }
  if (!mobile) {
    mobile = all.find(phone => phone !== office) ?? "";
    mobileConfidence = mobile ? "medium" : "low";
  }

  return {
    mobile: createCandidate(mobile, mobileConfidence),
    office: createCandidate(office, officeConfidence)
  };
}

function findBestName(lines: LineRecord[]) {
  const candidates = lines
    .map(line => ({ line, score: scoreName(line) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  return createCandidate(best?.line.cleaned ?? "", best && best.score >= 11 ? "high" : "medium");
}

function scoreName(line: LineRecord) {
  const value = line.cleaned;

  if (!/^[A-Za-z][A-Za-z\s.'-]{3,}$/.test(value)) {
    return -10;
  }

  const words = value.split(/\s+/);
  if (words.length < 2 || words.length > 4) {
    return -8;
  }

  let score = 0;

  if (words.every(word => /^[A-Z][A-Za-z.'-]+$/.test(word))) {
    score += 7;
  }

  if (line.index >= 1) {
    score += 2;
  }

  if (!isLikelyCompany(value)) {
    score += 2;
  }

  if (!isLikelyTitle(value)) {
    score += 2;
  }

  if (looksLikeAddress(value) || looksLikeContactMeta(value)) {
    score -= 8;
  }

  return score;
}

function findBestTitle(lines: LineRecord[], fullName: string) {
  const candidates = lines
    .filter(line => line.cleaned !== fullName)
    .map(line => ({ line, score: scoreTitle(line) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  return createCandidate(best?.line.cleaned ?? "", best && best.score >= 8 ? "high" : "medium");
}

function scoreTitle(line: LineRecord) {
  let score = 0;

  if (isLikelyTitle(line.cleaned)) {
    score += 7;
  }

  if (/\b(new|used|car|auto|sales|service|associate|manager|director)\b/i.test(line.cleaned)) {
    score += 3;
  }

  if (looksLikeContactMeta(line.cleaned) || looksLikeAddress(line.cleaned)) {
    score -= 8;
  }

  return score;
}

function findBestCompany(lines: LineRecord[], fullName: string, title: string) {
  const candidates = lines
    .filter(line => line.cleaned !== fullName && line.cleaned !== title)
    .map(line => ({ line, score: scoreCompany(line) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  return createCandidate(best?.line.cleaned ?? "", best && best.score >= 9 ? "high" : "medium");
}

function scoreCompany(line: LineRecord) {
  let score = 0;

  if (isLikelyCompany(line.cleaned)) {
    score += 7;
  }

  if (line.cleaned.includes("|")) {
    score += 3;
  }

  if (/^[A-Z0-9\s|&-]{6,}$/.test(line.cleaned)) {
    score += 2;
  }

  if (isLikelyTitle(line.cleaned)) {
    score -= 4;
  }

  if (looksLikeContactMeta(line.cleaned) || looksLikeAddress(line.cleaned)) {
    score -= 8;
  }

  return score;
}

function findBestAddress(lines: LineRecord[], email: string, website: string, mobilePhone: string, officePhone: string) {
  const candidates = lines.filter(line => {
    const value = line.cleaned;
    return value !== email
      && value !== website
      && value !== mobilePhone
      && value !== officePhone
      && looksLikeAddress(value);
  });

  if (candidates.length === 0) {
    return createCandidate("", "low");
  }

  const selected: string[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index];
    selected.push(current.cleaned);

    const next = candidates[index + 1];
    if (next && next.index === current.index + 1 && looksLikeAddressContinuation(next.cleaned)) {
      selected.push(next.cleaned);
      break;
    }

    if (selected.length >= 2) {
      break;
    }
  }

  return createCandidate(selected.join(", "), selected.length >= 2 ? "high" : "medium");
}

function isLikelyTitle(value: string) {
  const lower = value.toLowerCase();
  return TITLE_WORDS.some(token => lower.includes(token));
}

function isLikelyCompany(value: string) {
  const lower = value.toLowerCase();
  return COMPANY_WORDS.some(token => lower.includes(token)) || /^[A-Z0-9\s|&-]{6,}$/.test(value);
}

function looksLikeAddress(value: string) {
  return /\d/.test(value) && (
    /\b(st|street|rd|road|ave|avenue|blvd|drive|dr|unit|suite|floor|plaza|way|court|crt)\b/i.test(value) ||
    /\b(ontario|alberta|quebec|toronto|richmond hill|vancouver|canada)\b/i.test(value) ||
    /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(value)
  );
}

function looksLikeAddressContinuation(value: string) {
  return /\b(ontario|canada)\b/i.test(value) || /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(value);
}

function looksLikeContactMeta(value: string) {
  return /\b(www|http|@|cell|main|office|ext|phone|tel)\b/i.test(value);
}

function buildNotes(lines: LineRecord[], consumedValues: string[]) {
  const consumed = new Set(consumedValues.filter(Boolean));
  return lines
    .map(line => line.cleaned)
    .filter(line => !consumed.has(line))
    .join(" | ");
}
