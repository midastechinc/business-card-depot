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

type Candidate = {
  value: string;
  score: number;
  confidence: "high" | "medium" | "low";
  indices: number[];
};

type NormalizedLine = {
  raw: string;
  cleaned: string;
  lower: string;
  index: number;
  blockIndex: number;
  topScore: number;
  leftScore: number;
  widthScore: number;
  band: "top" | "middle" | "bottom";
  wordCount: number;
  hasDigits: boolean;
  hasEmail: boolean;
  hasWebsite: boolean;
  labels: string[];
  isUpperCaseish: boolean;
};

const TITLE_WORDS = [
  "advisor",
  "associate",
  "broker",
  "business",
  "coordinator",
  "consultant",
  "developer",
  "director",
  "engineer",
  "executive",
  "founder",
  "lead",
  "manager",
  "marketing",
  "officer",
  "operations",
  "owner",
  "president",
  "representative",
  "sales",
  "service",
  "specialist",
  "title",
  "vice president"
];

const SPECIALTY_WORDS = [
  "oncology",
  "surgery",
  "surgical",
  "cardiology",
  "dermatology",
  "orthopedic",
  "orthopaedic",
  "medicine",
  "medical",
  "clinic",
  "specialty"
];

const CREDENTIAL_WORDS = [
  "md",
  "msc",
  "frcsc",
  "phd",
  "mba",
  "bsc",
  "dds",
  "rn",
  "np"
];

const COMPANY_WORDS = [
  "agency",
  "auto",
  "bank",
  "college",
  "company",
  "consulting",
  "corp",
  "dealership",
  "group",
  "inc",
  "lexus",
  "limited",
  "ltd",
  "llc",
  "motors",
  "organization",
  "solutions",
  "studio",
  "systems",
  "technologies",
  "toyota",
  "university"
];

const ADDRESS_WORDS = [
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

export function parseContactFromText(text: string, sourceType: SourceType = "card"): ParsedContactResult {
  return parseContactFromOcr(
    {
      text,
      lines: text
        .replace(/\r/g, "")
        .split("\n")
        .map((line, index) => ({ text: line, lineIndex: index })),
      engine: "web-tesseract"
    },
    sourceType
  );
}

export function parseContactFromOcr(payload: OcrPayload, sourceType: SourceType = "card"): ParsedContactResult {
  const normalizedText = payload.text.replace(/\r/g, "");
  const lines = normalizeLines(payload.lines, normalizedText);

  const emailCandidates = buildEmailCandidates(lines, normalizedText);
  const websiteCandidates = buildWebsiteCandidates(lines, normalizedText);
  const phoneCandidates = buildPhoneCandidates(lines);
  const addressCandidates = buildAddressCandidates(lines, [
    ...emailCandidates.map(candidate => candidate.value),
    ...websiteCandidates.map(candidate => candidate.value),
    ...phoneCandidates.mobile.map(candidate => candidate.value),
    ...phoneCandidates.office.map(candidate => candidate.value)
  ]);
  const companyCandidates = buildCompanyCandidates(lines, sourceType);
  const titleCandidates = buildTitleCandidates(lines, sourceType, companyCandidates);
  const nameCandidates = buildNameCandidates(lines, sourceType, companyCandidates, titleCandidates);

  const fullName = chooseDistinctCandidate(nameCandidates, [], sourceType === "screenshot" ? 12 : 0);
  const company = chooseDistinctCandidate(companyCandidates, [fullName.value], sourceType === "screenshot" ? 12 : 0);
  const title = chooseDistinctCandidate(titleCandidates, [fullName.value, company.value], sourceType === "screenshot" ? 10 : 0);
  const email = chooseDistinctCandidate(emailCandidates);
  const website = chooseDistinctCandidate(websiteCandidates, [email.value]);
  const officePhone = chooseDistinctCandidate(phoneCandidates.office);
  const mobilePhone = chooseDistinctCandidate(phoneCandidates.mobile, [officePhone.value]);
  const address = chooseDistinctCandidate(addressCandidates, [
    email.value,
    website.value,
    officePhone.value,
    mobilePhone.value
  ], sourceType === "screenshot" ? 10 : 0);

  const draft: ContactDraft = {
    fullName: fullName.value,
    company: company.value,
    title: title.value,
    mobilePhone: mobilePhone.value,
    officePhone: officePhone.value,
    email: email.value,
    website: website.value,
    address: address.value,
    notes: buildNotes(lines, [
      fullName.value,
      company.value,
      title.value,
      mobilePhone.value,
      officePhone.value,
      email.value,
      website.value,
      address.value
    ])
  };

  return {
    draft,
    fieldConfidence: {
      fullName: fullName.confidence,
      company: company.confidence,
      title: title.confidence,
      mobilePhone: mobilePhone.confidence,
      officePhone: officePhone.confidence,
      email: email.confidence,
      website: website.confidence,
      address: address.confidence,
      notes: draft.notes ? "medium" : "low"
    },
    lines: lines.map(line => line.cleaned),
    suggestions: {
      fullName: nameCandidates.slice(0, 3).map(candidate => candidate.value),
      company: companyCandidates.slice(0, 3).map(candidate => candidate.value),
      title: titleCandidates.slice(0, 3).map(candidate => candidate.value),
      email: emailCandidates.slice(0, 3).map(candidate => candidate.value),
      website: websiteCandidates.slice(0, 3).map(candidate => candidate.value),
      mobilePhone: phoneCandidates.mobile.slice(0, 3).map(candidate => candidate.value),
      officePhone: phoneCandidates.office.slice(0, 3).map(candidate => candidate.value),
      address: addressCandidates.slice(0, 3).map(candidate => candidate.value)
    }
  };
}

function normalizeLines(inputLines: OcrInputLine[], fallbackText: string) {
  const source: OcrInputLine[] = inputLines.length > 0
    ? inputLines
    : fallbackText.split("\n").map((line, index) => ({ text: line, lineIndex: index }));

  const positioned = source
    .map((line, index) => ({
      raw: line.text ?? "",
      top: line.top ?? line.lineIndex ?? index,
      left: line.left ?? 0,
      right: line.right ?? (line.left ?? 0) + 1,
      blockIndex: line.blockIndex ?? 0,
      lineIndex: line.lineIndex ?? index
    }))
    .filter(line => line.raw.trim().length > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left);

  const maxTop = positioned[positioned.length - 1]?.top || 1;
  const minLeft = Math.min(...positioned.map(line => line.left), 0);
  const maxRight = Math.max(...positioned.map(line => line.right), 1);
  const fullWidth = Math.max(maxRight - minLeft, 1);

  return positioned.map((line, index): NormalizedLine => {
    const cleaned = cleanOcrLine(line.raw);
    const lower = cleaned.toLowerCase();
    const widthScore = clamp((line.right - line.left) / fullWidth);
    const topScore = clamp(line.top / maxTop);

    return {
      raw: line.raw,
      cleaned,
      lower,
      index,
      blockIndex: line.blockIndex,
      topScore,
      leftScore: clamp((line.left - minLeft) / fullWidth),
      widthScore,
      band: topScore < 0.33 ? "top" : topScore > 0.66 ? "bottom" : "middle",
      wordCount: cleaned.split(/\s+/).filter(Boolean).length,
      hasDigits: /\d/.test(cleaned),
      hasEmail: /@/.test(cleaned),
      hasWebsite: /\b(?:www\.|https?:\/\/|[a-z0-9-]+\.[a-z]{2,})/i.test(cleaned),
      labels: extractLabels(lower),
      isUpperCaseish: cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned)
    };
  });
}

function cleanOcrLine(value: string) {
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

function buildEmailCandidates(lines: NormalizedLine[], text: string) {
  const candidates = collectRegexCandidates(lines, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, candidate => ({
    ...candidate,
    score: candidate.score + 18,
    confidence: "high"
  }));

  const fallback = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (fallback) {
    candidates.push(makeCandidate(fallback, 12, "high"));
  }

  return dedupeCandidates(candidates.filter(candidate => isValidEmail(candidate.value)));
}

function buildWebsiteCandidates(lines: NormalizedLine[], text: string) {
  const candidates = collectRegexCandidates(lines, /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?/gi, candidate => ({
    ...candidate,
    score: candidate.score + 12,
    confidence: "medium"
  })).filter(candidate => !candidate.value.includes("@") && isValidWebsite(candidate.value));

  const fallback = extractWebsite(text);
  if (fallback) {
    candidates.push(makeCandidate(fallback, 10, "medium"));
  }

  return dedupeCandidates(candidates);
}

function buildPhoneCandidates(lines: NormalizedLine[]) {
  const mobile: Candidate[] = [];
  const office: Candidate[] = [];

  lines.forEach(line => {
    const matches = line.cleaned.match(/(?:\+\d{1,2}\s*)?(?:\(?\d{3}\)?[\s./-]*)\d{3}[\s./-]*\d{4}/g) ?? [];
    if (matches.length === 0) return;

    matches.forEach((match, matchIndex) => {
      const normalized = normalizePhone(match);
      if (!isValidPhone(normalized)) return;

      const baseScore = 8 + (line.labels.includes("office") || line.labels.includes("mobile") ? 6 : 0);
      const candidate = makeCandidate(normalized, baseScore, baseScore >= 14 ? "high" : "medium", [line.index]);

      if (line.labels.includes("mobile") || /\bcell|mobile|direct\b/i.test(line.cleaned)) {
        mobile.push({ ...candidate, score: candidate.score + 8, confidence: "high" });
      } else if (line.labels.includes("office") || /\bmain|office|tel|phone|ext\b/i.test(line.cleaned)) {
        office.push({ ...candidate, score: candidate.score + 8, confidence: "high" });
      } else if (matchIndex === 0) {
        office.push(candidate);
      } else {
        mobile.push(candidate);
      }
    });
  });

  return {
    mobile: dedupeCandidates(mobile),
    office: dedupeCandidates(office)
  };
}

function buildAddressCandidates(lines: NormalizedLine[], consumedValues: string[]) {
  const consumed = new Set(consumedValues.filter(Boolean));
  const candidates: Candidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (consumed.has(line.cleaned) || !looksLikeAddress(line.cleaned)) continue;

    const parts = [line.cleaned];
    const indices = [line.index];
    const next = lines[index + 1];
    const nextTwo = lines[index + 2];

    if (next && !consumed.has(next.cleaned) && looksLikeAddressContinuation(next.cleaned)) {
      parts.push(next.cleaned);
      indices.push(next.index);
    } else if (next && !consumed.has(next.cleaned) && next.band === line.band && next.wordCount <= 5 && looksGeoSpecific(next.cleaned)) {
      parts.push(next.cleaned);
      indices.push(next.index);
    }

    if (nextTwo && !consumed.has(nextTwo.cleaned) && parts.length === 2 && looksGeoSpecific(nextTwo.cleaned)) {
      parts.push(nextTwo.cleaned);
      indices.push(nextTwo.index);
    }

    const value = parts.join(", ");
    let score = 10;
    if (parts.length > 1) score += 6;
    if (/\b(canada|usa|ontario|alberta|quebec)\b/i.test(value)) score += 3;
    if (/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(value)) score += 3;

    candidates.push(makeCandidate(value, score, score >= 15 ? "high" : "medium", indices));
  }

  return dedupeCandidates(candidates);
}

function buildCompanyCandidates(lines: NormalizedLine[], sourceType: SourceType) {
  return dedupeCandidates(
    lines
      .filter(line => !line.hasEmail && !line.hasWebsite && !looksLikeAddress(line.cleaned) && !isLikelyPhoneLabel(line.lower))
      .map(line => {
        let score = 0;
        if (line.labels.includes("company")) score += 14;
        if (isLikelyCompany(line.cleaned)) score += 8;
        if (line.band === "top") score += 6;
        if (line.widthScore > 0.45) score += 3;
        if (line.isUpperCaseish) score += 4;
        if (line.cleaned.includes("|")) score += 3;
        if (sourceType === "screenshot" && line.band !== "bottom") score += 2;
        if (sourceType === "screenshot" && isSpecialtyHeading(line.cleaned)) score += 6;
        if (looksLikePersonName(line.cleaned)) score -= 5;
        if (looksLikeCredentialLine(line.cleaned)) score -= 12;
        if (isLikelyTitle(line.cleaned)) score -= 4;
        return makeCandidate(line.cleaned, score, score >= 15 ? "high" : score >= 9 ? "medium" : "low", [line.index]);
      })
      .filter(candidate => candidate.score > 4)
  );
}

function buildTitleCandidates(lines: NormalizedLine[], sourceType: SourceType, companyCandidates: Candidate[]) {
  const primaryCompany = companyCandidates[0]?.value ?? "";

  return dedupeCandidates(
    lines
      .filter(line => line.cleaned !== primaryCompany && !line.hasEmail && !line.hasWebsite && !line.hasDigits && !looksLikeAddress(line.cleaned))
      .map(line => {
        let score = 0;
        if (line.labels.includes("title")) score += 14;
        if (isLikelyTitle(line.cleaned)) score += 10;
        if (sourceType === "screenshot" && isSpecialtyHeading(line.cleaned)) score += 7;
        if (line.band === "bottom") score += 4;
        if (sourceType === "screenshot" && line.band !== "top") score += 1;
        if (line.wordCount >= 2 && line.wordCount <= 6) score += 2;
        if (isLikelyCompany(line.cleaned)) score -= 5;
        if (looksLikeCredentialLine(line.cleaned)) score -= 12;
        return makeCandidate(line.cleaned, score, score >= 15 ? "high" : score >= 9 ? "medium" : "low", [line.index]);
      })
      .filter(candidate => candidate.score > 4)
  );
}

function buildNameCandidates(lines: NormalizedLine[], sourceType: SourceType, companyCandidates: Candidate[], titleCandidates: Candidate[]) {
  const primaryCompany = companyCandidates[0]?.value ?? "";
  const titleIndexes = titleCandidates.flatMap(candidate => candidate.indices);

  return dedupeCandidates(
    lines
      .filter(line => line.cleaned !== primaryCompany && !line.hasEmail && !line.hasWebsite && !line.hasDigits && !looksLikeAddress(line.cleaned))
      .map(line => {
        let score = 0;
        if (line.labels.includes("name")) score += 14;
        if (looksLikePersonName(line.cleaned)) score += 12;
        if (/^\s*dr\.?\s+/i.test(line.cleaned)) score += 10;
        if (line.wordCount >= 2 && line.wordCount <= 4) score += 3;
        if (line.band === "bottom") score += 5;
        if (line.band === "middle") score += 2;
        if (titleIndexes.some(index => Math.abs(index - line.index) <= 1)) score += 5;
        if (sourceType === "screenshot") score += 1;
        if (line.isUpperCaseish) score -= 3;
        if (isLikelyCompany(line.cleaned)) score -= 6;
        if (isLikelyTitle(line.cleaned)) score -= 4;
        if (looksLikeCredentialLine(line.cleaned)) score -= 12;
        if (isSpecialtyHeading(line.cleaned)) score -= 8;
        return makeCandidate(line.cleaned, score, score >= 16 ? "high" : score >= 10 ? "medium" : "low", [line.index]);
      })
      .filter(candidate => candidate.score > 5)
  );
}

function chooseDistinctCandidate(candidates: Candidate[], disallowedValues: string[] = [], minimumScore = 0) {
  const disallowed = new Set(disallowedValues.filter(Boolean).map(normalizeComparable));
  const selected = candidates.find(candidate => candidate.score >= minimumScore && !disallowed.has(normalizeComparable(candidate.value)));
  return selected ?? makeCandidate("", 0, "low");
}

function buildNotes(lines: NormalizedLine[], consumedValues: string[]) {
  const consumed = new Set(consumedValues.filter(Boolean).map(normalizeComparable));
  const seen = new Set<string>();

  return lines
    .map(line => line.cleaned)
    .filter(value => !consumed.has(normalizeComparable(value)))
    .filter(value => !looksLikeDecorativeNoise(value))
    .filter(value => {
      const key = normalizeComparable(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" | ");
}

function collectRegexCandidates(
  lines: NormalizedLine[],
  pattern: RegExp,
  scorer: (candidate: Candidate) => Candidate
) {
  const candidates: Candidate[] = [];

  lines.forEach(line => {
    const matches = line.cleaned.match(pattern) ?? [];
    matches.forEach(match => {
      const baseScore = 6 + (line.labels.length > 0 ? 4 : 0) + (line.widthScore > 0.3 ? 1 : 0);
      candidates.push(scorer(makeCandidate(match, baseScore, "medium", [line.index])));
    });
  });

  return candidates;
}

function makeCandidate(value: string, score: number, confidence: "high" | "medium" | "low", indices: number[] = []): Candidate {
  return {
    value: value.trim(),
    score,
    confidence,
    indices
  };
}

function dedupeCandidates(candidates: Candidate[]) {
  const seen = new Map<string, Candidate>();

  candidates
    .filter(candidate => candidate.value)
    .forEach(candidate => {
      const key = normalizeComparable(candidate.value);
      const existing = seen.get(key);
      if (!existing || candidate.score > existing.score) {
        seen.set(key, candidate);
      }
    });

  return Array.from(seen.values()).sort((left, right) => right.score - left.score);
}

function normalizeComparable(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizePhone(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikePersonName(value: string) {
  if (!/^[A-Za-z][A-Za-z\s.'-]{3,}$/.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  const filtered = words.filter(word => !/^dr\.?$/i.test(word));
  if (filtered.some(word => TITLE_WORDS.includes(word.toLowerCase()))) return false;
  if (filtered.some(word => CREDENTIAL_WORDS.includes(word.toLowerCase()))) return false;
  return filtered.filter(word => /^[A-Z][A-Za-z.'-]+$/.test(word)).length >= 2;
}

function isLikelyTitle(value: string) {
  const lower = value.toLowerCase();
  return TITLE_WORDS.some(token => lower.includes(token)) || SPECIALTY_WORDS.some(token => lower.includes(token));
}

function isLikelyCompany(value: string) {
  const lower = value.toLowerCase();
  return COMPANY_WORDS.some(token => lower.includes(token)) || (/^[A-Z0-9\s|&-]{6,}$/.test(value) && value.split(/\s+/).length >= 2);
}

function isLikelyPhoneLabel(lower: string) {
  return /\b(cell|mobile|main|office|tel|phone|ext)\b/.test(lower);
}

function isValidEmail(value: string) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
}

function isValidWebsite(value: string) {
  return /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(value);
}

function isValidPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 12;
}

function extractWebsite(value: string) {
  const matches = value.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?/gi) ?? [];
  return matches.find(candidate => !candidate.includes("@")) ?? "";
}

function looksLikeAddress(value: string) {
  const lower = value.toLowerCase();
  return /\d/.test(value) && (
    ADDRESS_WORDS.some(word => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(value)) ||
    /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(value) ||
    /\b[a-z]+,\s*[a-z]+\b/i.test(lower)
  );
}

function looksGeoSpecific(value: string) {
  return /\b(canada|usa|ontario|alberta|quebec|toronto|vancouver|richmond hill)\b/i.test(value) || /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(value);
}

function looksLikeAddressContinuation(value: string) {
  return looksLikeAddress(value) || looksGeoSpecific(value);
}

function looksLikeDecorativeNoise(value: string) {
  return /^[|.+\-_/\\\s]+$/.test(value);
}

function looksLikeCredentialLine(value: string) {
  const tokens = value.toLowerCase().split(/[\s,./-]+/).filter(Boolean);
  return tokens.length > 0 && tokens.every(token => CREDENTIAL_WORDS.includes(token));
}

function isSpecialtyHeading(value: string) {
  const lower = value.toLowerCase();
  return SPECIALTY_WORDS.some(token => lower.includes(token));
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
