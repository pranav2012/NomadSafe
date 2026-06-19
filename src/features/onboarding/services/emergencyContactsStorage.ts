import { storage } from "@/stores/storage";

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string | null;
}

const EMERGENCY_CONTACTS_KEY = "emergency-contacts";

export const emergencyContactsStorage = {
  get(): EmergencyContact[] {
    const raw = storage.getString(EMERGENCY_CONTACTS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as EmergencyContact[];
      return [];
    } catch {
      return [];
    }
  },

  set(contacts: EmergencyContact[]) {
    storage.set(EMERGENCY_CONTACTS_KEY, JSON.stringify(contacts));
  },

  clear() {
    storage.set(EMERGENCY_CONTACTS_KEY, "");
  },
};
