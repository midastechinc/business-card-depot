import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export type AdminSettings = {
  enableListSync: boolean;
  listDatabaseUrl: string;
};

const STORAGE_KEY = "business-card-depot.admin-settings";

export const defaultAdminSettings: AdminSettings = {
  enableListSync: false,
  listDatabaseUrl: ""
};

export async function loadAdminSettings(): Promise<AdminSettings> {
  const raw = await readValue();
  if (!raw) return defaultAdminSettings;

  try {
    const parsed = JSON.parse(raw);
    return {
      enableListSync: Boolean(parsed?.enableListSync),
      listDatabaseUrl: typeof parsed?.listDatabaseUrl === "string" ? parsed.listDatabaseUrl : ""
    };
  } catch {
    return defaultAdminSettings;
  }
}

export async function saveAdminSettings(settings: AdminSettings) {
  await writeValue(JSON.stringify(settings));
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
