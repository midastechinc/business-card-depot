import { Platform } from "react-native";
import type { SavedContactEntry } from "./contactActions";

const STORAGE_KEY = "business-card-depot.saved-contacts";

let inMemorySavedContacts: SavedContactEntry[] = [];

export function loadSavedContacts() {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.localStorage) {
    try {
      const rawValue = window.localStorage.getItem(STORAGE_KEY);
      if (!rawValue) {
        return [];
      }

      const parsed = JSON.parse(rawValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return inMemorySavedContacts;
}

export function saveSavedContacts(entries: SavedContactEntry[]) {
  inMemorySavedContacts = entries;

  if (Platform.OS === "web" && typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Ignore storage errors and keep in-memory state.
    }
  }
}
