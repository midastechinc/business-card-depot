import type { AdminSettings } from "./adminSettings";
import type { ContactDraft, ContactField, ParsedContactResult } from "./contactParser";
import {
  dedupeTextValues,
  isValidEmail,
  isValidWebsite,
  normalizeAcceptedPhoneValue,
  normalizeAddressValue,
  normalizeComparable,
  normalizeWebsiteValue
} from "./fieldValidators";

type Confidence = "high" | "medium" | "low";
type SourceType = "card" | "screenshot";

type AiFieldPayload = {
  value?: string;
  confidence?: Confidence;
  alternatives?: string[];
};

type AiVerificationEnvelope = Partial<Record<ContactField, AiFieldPayload>> & {
  notes?: string | AiFieldPayload;
  reviewSummary?: string;
};

type AiVerificationRequest = {
  settings: AdminSettings;
  sourceType: SourceType;
  ocrText: string;
  parsedResult: ParsedContactResult;
};

type AiVerificationResponse = {
  draft: Partial<ContactDraft>;
  fieldConfidence: Partial<Record<ContactField, Confidence>>;
  suggestions: Partial<Record<ContactField, string[]>>;
  reviewSummary: string;
};

const fieldOrder: ContactField[] = [
  "fullName",
  "company",
  "title",
  "mobilePhone",
  "officePhone",
  "email",
  "website",
  "address",
  "notes"
];

export async function verifyParsedContactWithAi({
  settings,
  sourceType,
  ocrText,
  parsedResult
}: AiVerificationRequest): Promise<AiVerificationResponse> {
  const response = await fetch(settings.aiApiUrl.trim(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.aiApiKey.trim()}`
    },
    body: JSON.stringify({
      model: settings.aiModel.trim(),
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            "You verify OCR business-card extraction.",
            "Return JSON only.",
            "Do not invent data that is not present in the OCR text.",
            "Focus only on these fields: fullName, company, title, mobilePhone, officePhone, email, website, address, notes.",
            "Prefer blank values over wrong guesses.",
            "Use confidence high, medium, or low.",
            "Use alternatives only when there is a realistic competing option."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Verify OCR extraction and return corrected structured fields.",
            sourceType,
            currentDraft: parsedResult.draft,
            currentConfidence: parsedResult.fieldConfidence,
            currentSuggestions: parsedResult.suggestions,
            ocrText
          })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`AI verification failed with status ${response.status}.`);
  }

  const payload = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("AI verification returned an empty response.");
  }

  const parsed = parseJsonEnvelope(content);
  return normalizeAiEnvelope(parsed);
}

export async function testAiVerificationConnection(settings: AdminSettings) {
  await verifyParsedContactWithAi({
    settings,
    sourceType: "card",
    ocrText: [
      "Midas Tech",
      "Ali Jaffar",
      "Director",
      "Cell: (647) 555-1234",
      "info@midastech.ca",
      "www.midastech.ca"
    ].join("\n"),
    parsedResult: {
      draft: {
        fullName: "Ali Jaffar",
        company: "Midas Tech",
        title: "Director",
        mobilePhone: "(647) 555-1234",
        officePhone: "",
        email: "info@midastech.ca",
        website: "www.midastech.ca",
        address: "",
        notes: ""
      },
      fieldConfidence: {
        fullName: "medium",
        company: "medium",
        title: "medium",
        mobilePhone: "medium",
        officePhone: "low",
        email: "high",
        website: "medium",
        address: "low",
        notes: "low"
      },
      lines: [],
      suggestions: {}
    }
  });
}

export function mergeAiVerificationIntoParsed(
  parsedResult: ParsedContactResult,
  aiResult: AiVerificationResponse
): ParsedContactResult {
  const draft = { ...parsedResult.draft };
  const fieldConfidence = { ...parsedResult.fieldConfidence };
  const suggestions: ParsedContactResult["suggestions"] = { ...parsedResult.suggestions };

  fieldOrder.forEach(field => {
    const aiValue = normalizeFieldValue(field, aiResult.draft[field] ?? "");
    const aiConfidence = aiResult.fieldConfidence[field] ?? "low";
    const currentValue = draft[field];
    const currentConfidence = fieldConfidence[field];

    if (shouldReplaceField(field, currentValue, currentConfidence, aiValue, aiConfidence)) {
      draft[field] = aiValue;
      fieldConfidence[field] = aiConfidence;
    } else if (aiValue && !currentValue) {
      draft[field] = aiValue;
      fieldConfidence[field] = aiConfidence;
    }

    suggestions[field] = dedupeTextValues([
      draft[field],
      ...(aiResult.suggestions[field] ?? []),
      ...(parsedResult.suggestions[field] ?? [])
    ]).slice(0, 4);
  });

  if (aiResult.reviewSummary) {
    draft.notes = dedupeTextValues([draft.notes, aiResult.reviewSummary]).join(" | ");
  }

  return {
    draft,
    fieldConfidence,
    lines: parsedResult.lines,
    suggestions
  };
}

function parseJsonEnvelope(content: string): AiVerificationEnvelope {
  const fencedMatch = content.match(/```json\s*([\s\S]*?)```/i) ?? content.match(/```\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1] ?? content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  const jsonText = start >= 0 && end >= start ? candidate.slice(start, end + 1) : candidate;
  return JSON.parse(jsonText) as AiVerificationEnvelope;
}

function normalizeAiEnvelope(envelope: AiVerificationEnvelope): AiVerificationResponse {
  const draft: Partial<ContactDraft> = {};
  const fieldConfidence: Partial<Record<ContactField, Confidence>> = {};
  const suggestions: Partial<Record<ContactField, string[]>> = {};

  fieldOrder.forEach(field => {
    const rawField = envelope[field];
    const normalized = normalizeFieldPayload(field, rawField);
    if (normalized.value) {
      draft[field] = normalized.value;
    }
    if (normalized.confidence) {
      fieldConfidence[field] = normalized.confidence;
    }
    if (normalized.alternatives.length > 0) {
      suggestions[field] = normalized.alternatives;
    }
  });

  return {
    draft,
    fieldConfidence,
    suggestions,
    reviewSummary: typeof envelope.reviewSummary === "string" ? envelope.reviewSummary.trim() : ""
  };
}

function normalizeFieldPayload(field: ContactField, payload: unknown) {
  if (typeof payload === "string") {
    return {
      value: normalizeFieldValue(field, payload),
      confidence: "medium" as Confidence,
      alternatives: [] as string[]
    };
  }

  if (!payload || typeof payload !== "object") {
    return {
      value: "",
      confidence: undefined,
      alternatives: [] as string[]
    };
  }

  const value = "value" in payload && typeof payload.value === "string" ? normalizeFieldValue(field, payload.value) : "";
  const confidence = "confidence" in payload && isConfidence(payload.confidence) ? payload.confidence : undefined;
  const alternatives = "alternatives" in payload && Array.isArray(payload.alternatives)
    ? dedupeTextValues(payload.alternatives.filter((item): item is string => typeof item === "string").map(item => normalizeFieldValue(field, item))).filter(Boolean)
    : [];

  return { value, confidence, alternatives };
}

function shouldReplaceField(
  field: ContactField,
  currentValue: string,
  currentConfidence: Confidence,
  aiValue: string,
  aiConfidence: Confidence
) {
  if (!aiValue) return false;
  if (!currentValue) return true;
  if (normalizeComparable(aiValue) === normalizeComparable(currentValue)) return false;

  if (field === "email" || field === "website" || field === "mobilePhone" || field === "officePhone") {
    return rankConfidence(aiConfidence) >= rankConfidence(currentConfidence);
  }

  if (currentConfidence === "low" && aiConfidence !== "low") return true;
  if (currentConfidence === "medium" && aiConfidence === "high") return true;
  return false;
}

function normalizeFieldValue(field: ContactField, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  switch (field) {
    case "email":
      return isValidEmail(trimmed) ? trimmed.toLowerCase() : "";
    case "website":
      return normalizeWebsiteValue(trimmed);
    case "mobilePhone":
    case "officePhone":
      return normalizeAcceptedPhoneValue(trimmed);
    case "address":
      return normalizeAddressValue(trimmed);
    default:
      return trimmed;
  }
}

function isConfidence(value: unknown): value is Confidence {
  return value === "high" || value === "medium" || value === "low";
}

function rankConfidence(value: Confidence) {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}
