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

export type OcrInputLine = {
  text: string;
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  blockIndex?: number;
  lineIndex?: number;
};

export type OcrPayload = {
  text: string;
  lines: OcrInputLine[];
  engine: "web-tesseract" | "native-mlkit";
};

export type ParsedContactResult = {
  draft: ContactDraft;
  fieldConfidence: Record<ContactField, "high" | "medium" | "low">;
  lines: string[];
  suggestions: Partial<Record<ContactField, string[]>>;
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

type SourceType = "card" | "screenshot";

type NormalizedLine = {
  raw: string;
  cleaned: string;
  lower: string;
  index: number;
  topScore: number;
  hasDigits: boolean;
  hasEmail: boolean;
  hasWebsite: boolean;
  labels: string[];
};

type Candidate = {
  value: string;
  confidence: "high" | "medium" | "low";
  score: number;
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
  "representative",
  "officer",
  "consulting",
  "lead"
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
  "dealership",
  "agency",
  "bank",
  "university",
  "college"
];

export function parseContactFromText(text: string, sourceType: SourceType = "card"): ParsedContactResult {
  return parseContactFromOcr(
    {
      text,
      lines: text
        .replace(/\r/g, "")
        .split("\n")
        .map(line => ({ text: line })),
      engine: "web-tesseract"
    },
    sourceType
  );
}

export function parseContactFromOcr(payload: OcrPayload, sourceType: SourceType = "card"): ParsedContactResult {
  const normalizedText = payload.text.replace(/\r/g, "");
  const lines = normalizeLines(payload.lines, normalizedText);

  const emailCandidate = candidateFromValue(
    findLabeledValue(lines, ["email", "e-mail"]) || firstMatch(normalizedText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i),
    "high",
    18
  );
  const websiteCandidate = candidateFromValue(
    findLabeledValue(lines, ["web", "website"]) || extractWebsite(normalizedText),
    "medium",
    12
  );
  const phones = extractPhones(lines);
  const addressCandidate = findAddress(lines, emailCandidate.value, websiteCandidate.value, phones.mobile.value, phones.office.value);
  const companyCandidates = rankLines(lines, line => scoreCompany(line, sourceType), [emailCandidate.value, websiteCandidate.value, addressCandidate.value]);
  const nameCandidates = rankLines(lines, line => scoreName(line, companyCandidates[0]?.value ?? "", sourceType), [
    emailCandidate.value,
    websiteCandidate.value,
    addressCandidate.value
  ]);
  const titleCandidates = rankLines(
    lines,
    line => scoreTitle(line, nameCandidates[0]?.value ?? "", companyCandidates[0]?.value ?? "", sourceType),
    [emailCandidate.value, websiteCandidate.value, addressCandidate.value]
  );

  const fullName = toCandidate(nameCandidates[0]);
  const company = toCandidate(companyCandidates[0]);
  const title = toCandidate(titleCandidates[0]);
  const notesValue = buildNotes(lines, [
    fullName.value,
    company.value,
    title.value,
    emailCandidate.value,
    websiteCandidate.value,
    phones.mobile.value,
    phones.office.value,
    addressCandidate.value
  ]);

  return {
    draft: {
      fullName: fullName.value,
      company: company.value,
      title: title.value,
      mobilePhone: phones.mobile.value,
      officePhone: phones.office.value,
      email: emailCandidate.value,
      website: websiteCandidate.value,
      address: addressCandidate.value,
      notes: notesValue
    },
    fieldConfidence: {
      fullName: fullName.confidence,
      company: company.confidence,
      title: title.confidence,
      mobilePhone: phones.mobile.confidence,
      officePhone: phones.office.confidence,
      email: emailCandidate.confidence,
      website: websiteCandidate.confidence,
      address: addressCandidate.confidence,
      notes: notesValue ? "medium" : "low"
    },
    lines: lines.map(line => line.cleaned),
    suggestions: {
      fullName: nameCandidates.slice(0, 3).map(candidate => candidate.value),
      company: companyCandidates.slice(0, 3).map(candidate => candidate.value),
      title: titleCandidates.slice(0, 3).map(candidate => candidate.value)
    }
  };
}

function normalizeLines(inputLines: OcrInputLine[], fallbackText: string) {
  const source: OcrInputLine[] = inputLines.length > 0
    ? inputLines
    : fallbackText.split("\n").map((line, index) => ({ text: line, lineIndex: index }));

  const positioned = source
    .map((line, index) => ({
      index,
      raw: line.text ?? "",
      top: line.top ?? line.lineIndex ?? index,
      left: line.left ?? 0
    }))
    .filter(line => line.raw.trim().length > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left);

  const maxTop = positioned[positioned.length - 1]?.top ?? 1;

  return positioned.map((line, index) => {
    const cleaned = cleanOcrLine(line.raw);
    const lower = cleaned.toLowerCase();

    return {
      raw: line.raw,
      cleaned,
      lower,
      index,
      topScore: maxTop === 0 ? 0 : line.top / maxTop,
      hasDigits: /\d/.test(cleaned),
      hasEmail: /@/.test(cleaned),
      hasWebsite: /\b(?:www\.|https?:\/\/|[a-z0-9-]+\.[a-z]{2,})/i.test(cleaned),
      labels: extractLabels(lower)
    };
  });
}

function cleanOcrLine(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[•·]/g, " ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\bwww\s+/gi, "www.")
    .replace(/\s*@\s*/g, "@")
    .trim();
}

function extractLabels(lower: string) {
  const labels: string[] = [];
  if (/\b(name|contact)\b/.test(lower)) labels.push("name");
  if (/\b(company|organization|org)\b/.test(lower)) labels.push("company");
  if (/\b(title|position|role)\b/.test(lower)) labels.push("title");
  if (/\b(cell|mobile|direct)\b/.test(lower)) labels.push("mobile");
  if (/\b(main|office|tel|phone|ext)\b/.test(lower)) labels.push("office");
  if (/\b(email|e-mail)\b/.test(lower)) labels.push("email");
  if (/\b(web|website)\b/.test(lower)) labels.push("website");
  if (/\b(address|suite|unit)\b/.test(lower)) labels.push("address");
  return labels;
}

function candidateFromValue(value: string, confidence: "high" | "medium" | "low", score: number): Candidate {
  return {
    value: value.trim(),
    confidence: value ? confidence : "low",
    score: value ? score : 0
  };
}

function toCandidate(candidate?: Pick<Candidate, "value" | "score"> | Candidate): Candidate {
  if (!candidate?.value) {
    return { value: "", confidence: "low", score: 0 };
  }

  return {
    value: candidate.value,
    confidence: candidate.score >= 14 ? "high" : candidate.score >= 8 ? "medium" : "low",
    score: candidate.score
  };
}

function rankLines(
  lines: NormalizedLine[],
  scorer: (line: NormalizedLine) => number,
  consumedValues: string[]
) {
  const consumed = new Set(consumedValues.filter(Boolean));

  return lines
    .filter(line => !consumed.has(line.cleaned))
    .map(line => ({ value: line.cleaned, score: scorer(line) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
}

function scoreName(line: NormalizedLine, companyValue: string, sourceType: SourceType) {
  const value = line.cleaned;
  const words = value.split(/\s+/);

  if (!/^[A-Za-z][A-Za-z\s.'-]{3,}$/.test(value)) return -12;
  if (words.length < 2 || words.length > 4) return -8;
  if (line.hasEmail || line.hasWebsite || line.hasDigits) return -12;
  if (looksLikeAddress(line.cleaned) || isLikelyPhoneLabel(line.lower)) return -10;

  let score = 0;
  if (line.labels.includes("name")) score += 14;
  if (words.every(word => /^[A-Z][A-Za-z.'-]+$/.test(word))) score += 8;
  if (line.topScore > 0.35) score += 4;
  if (line.topScore > 0.55) score += 3;
  if (!isLikelyCompany(line.cleaned)) score += 3;
  if (!isLikelyTitle(line.cleaned)) score += 3;
  if (companyValue && line.cleaned !== companyValue && Math.abs(words.length - companyValue.split(/\s+/).length) > 0) score += 1;
  if (sourceType === "screenshot") score += 1;
  if (/^[A-Z\s]+$/.test(value)) score -= 5;
  if (isLikelyCompany(value)) score -= 4;
  if (isLikelyTitle(value)) score -= 3;
  return score;
}

function scoreCompany(line: NormalizedLine, sourceType: SourceType) {
  if (line.hasEmail || line.hasWebsite) return -10;
  if (looksLikeAddress(line.cleaned) || isLikelyPhoneLabel(line.lower)) return -10;

  let score = 0;
  if (line.labels.includes("company")) score += 14;
  if (isLikelyCompany(line.cleaned)) score += 8;
  if (line.cleaned.includes("|")) score += 4;
  if (/^[A-Z0-9\s|&-]{6,}$/.test(line.cleaned)) score += 4;
  if (line.topScore < 0.35) score += 4;
  if (sourceType === "screenshot" && line.topScore < 0.55) score += 2;
  if (isLikelyTitle(line.cleaned)) score -= 4;
  if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(line.cleaned)) score -= 5;
  return score;
}

function scoreTitle(line: NormalizedLine, nameValue: string, companyValue: string, sourceType: SourceType) {
  if (!line.cleaned || line.cleaned === nameValue || line.cleaned === companyValue) return -10;
  if (line.hasEmail || line.hasWebsite || line.hasDigits) return -10;
  if (looksLikeAddress(line.cleaned)) return -10;

  let score = 0;
  if (line.labels.includes("title")) score += 14;
  if (isLikelyTitle(line.cleaned)) score += 8;
  if (/\b(new|used|car|auto|sales|service|associate|manager|director|advisor)\b/i.test(line.cleaned)) score += 5;
  if (line.topScore > 0.3) score += 2;
  if (sourceType === "screenshot") score += 1;
  if (isLikelyCompany(line.cleaned)) score -= 3;
  return score;
}

function findAddress(
  lines: NormalizedLine[],
  email: string,
  website: string,
  mobilePhone: string,
  officePhone: string
) {
  const candidates = lines.filter(line => {
    const value = line.cleaned;
    return value
      && value !== email
      && value !== website
      && value !== mobilePhone
      && value !== officePhone
      && looksLikeAddress(value);
  });

  if (candidates.length === 0) {
    return candidateFromValue("", "low", 0);
  }

  const selected: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index];
    selected.push(current.cleaned);

    const next = candidates[index + 1];
    if (next && Math.abs(next.index - current.index) <= 1 && looksLikeAddressContinuation(next.cleaned)) {
      selected.push(next.cleaned);
      break;
    }
  }

  return candidateFromValue(selected.join(", "), selected.length > 1 ? "high" : "medium", selected.length > 1 ? 15 : 9);
}

function extractPhones(lines: NormalizedLine[]) {
  let mobile = candidateFromValue("", "low", 0);
  let office = candidateFromValue("", "low", 0);

  for (const line of lines) {
    const matches = line.cleaned.match(/(?:\+\d{1,2}\s*)?(?:\(?\d{3}\)?[\s./-]*)\d{3}[\s./-]*\d{4}/g) ?? [];
    if (matches.length === 0) continue;

    const primary = normalizePhone(matches[0] ?? "");
    const secondary = matches[1] ? normalizePhone(matches[1]) : "";

    if (!mobile.value && (line.labels.includes("mobile") || /\bcell\b/i.test(line.cleaned))) {
      mobile = candidateFromValue(primary, "high", 18);
    }

    if (!office.value && (line.labels.includes("office") || /\b(main|office|tel|ext)\b/i.test(line.cleaned))) {
      office = candidateFromValue(primary, "high", 18);
      if (!mobile.value && secondary) {
        mobile = candidateFromValue(secondary, "medium", 10);
      }
    }
  }

  const allPhones = lines
    .flatMap(line => line.cleaned.match(/(?:\+\d{1,2}\s*)?(?:\(?\d{3}\)?[\s./-]*)\d{3}[\s./-]*\d{4}/g) ?? [])
    .map(normalizePhone);

  if (!office.value && allPhones[0]) {
    office = candidateFromValue(allPhones[0], "medium", 10);
  }
  const fallbackMobile = allPhones.find(phone => phone !== office.value) ?? "";
  if (!mobile.value && fallbackMobile) {
    mobile = candidateFromValue(fallbackMobile, "medium", 10);
  }

  return { mobile, office };
}

function normalizePhone(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function findLabeledValue(lines: NormalizedLine[], labels: string[]) {
  for (const line of lines) {
    const matchedLabel = labels.find(label => line.lower.includes(label));
    if (!matchedLabel) continue;

    const pattern = new RegExp(`^.*?${matchedLabel}\\s*[:|-]?\\s*`, "i");
    const cleaned = line.cleaned.replace(pattern, "").trim();
    if (cleaned) return cleaned;
  }
  return "";
}

function extractWebsite(value: string) {
  const matches = value.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?/gi) ?? [];
  return matches.find(candidate => !candidate.includes("@")) ?? "";
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[0] ?? "";
}

function isLikelyTitle(value: string) {
  const lower = value.toLowerCase();
  return TITLE_WORDS.some(token => lower.includes(token));
}

function isLikelyCompany(value: string) {
  const lower = value.toLowerCase();
  return COMPANY_WORDS.some(token => lower.includes(token)) || /^[A-Z0-9\s|&-]{6,}$/.test(value);
}

function isLikelyPhoneLabel(lower: string) {
  return /\b(cell|mobile|main|office|tel|phone|ext)\b/.test(lower);
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

function buildNotes(lines: NormalizedLine[], consumedValues: string[]) {
  const consumed = new Set(consumedValues.filter(Boolean));

  return lines
    .map(line => line.cleaned)
    .filter(line => !consumed.has(line))
    .filter(line => !looksLikeDecorativeNoise(line))
    .join(" | ");
}

function looksLikeDecorativeNoise(value: string) {
  return /^[|.+\-_/\\\s]+$/.test(value);
}
