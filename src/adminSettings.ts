import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export type AdminSettings = {
  enableGoogleSheetsSync: boolean;
  googleSheetsWebhookUrl: string;
  enableAiVerification: boolean;
  aiApiUrl: string;
  aiApiKey: string;
  aiModel: string;
};

const STORAGE_KEY = "business-card-depot.admin-settings";

export const defaultAdminSettings: AdminSettings = {
  enableGoogleSheetsSync: false,
  googleSheetsWebhookUrl: "",
  enableAiVerification: false,
  aiApiUrl: "https://api.openai.com/v1/chat/completions",
  aiApiKey: "",
  aiModel: "gpt-4.1-mini"
};

export async function loadAdminSettings(): Promise<AdminSettings> {
  const raw = await readValue();
  if (!raw) return defaultAdminSettings;

  try {
    const parsed = JSON.parse(raw);
    return {
      enableGoogleSheetsSync: Boolean(parsed?.enableGoogleSheetsSync ?? parsed?.enableListSync),
      googleSheetsWebhookUrl:
        typeof parsed?.googleSheetsWebhookUrl === "string"
          ? parsed.googleSheetsWebhookUrl
          : typeof parsed?.listDatabaseUrl === "string"
            ? parsed.listDatabaseUrl
            : "",
      enableAiVerification: Boolean(parsed?.enableAiVerification),
      aiApiUrl:
        typeof parsed?.aiApiUrl === "string" && parsed.aiApiUrl.trim().length > 0
          ? parsed.aiApiUrl
          : defaultAdminSettings.aiApiUrl,
      aiApiKey: typeof parsed?.aiApiKey === "string" ? parsed.aiApiKey : "",
      aiModel:
        typeof parsed?.aiModel === "string" && parsed.aiModel.trim().length > 0
          ? parsed.aiModel
          : defaultAdminSettings.aiModel
    };
  } catch {
    return defaultAdminSettings;
  }
}

export async function saveAdminSettings(settings: AdminSettings) {
  await writeValue(JSON.stringify(settings));
}

export function hasAiVerificationConfigured(settings: AdminSettings) {
  return Boolean(
    settings.enableAiVerification
      && settings.aiApiUrl.trim()
      && settings.aiApiKey.trim()
      && settings.aiModel.trim()
  );
}

async function readValue() {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.localStorage) {
    return window.localStorage.getItem(STORAGE_KEY);
  }

  return await AsyncStorage.getItem(STORAGE_KEY);
}

async function writeValue(value: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, value);
    return;
  }

  await AsyncStorage.setItem(STORAGE_KEY, value);
}
