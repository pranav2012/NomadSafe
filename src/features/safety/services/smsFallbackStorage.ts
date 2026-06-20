import { storage } from "@/stores/storage";

export type SmsTemplatePurpose = "missedCheckIn" | "sos" | "invite" | "other";

const key = (purpose: SmsTemplatePurpose) => `sms-template-${purpose}`;

const DEFAULT_TEMPLATES: Record<SmsTemplatePurpose, string> = {
  missedCheckIn:
    "I missed my NomadSafe check-in. My last known location and safety status are attached. Please check on me.",
  sos: "SOS from NomadSafe. I need help urgently. My last known location is attached if GPS is available.",
  invite:
    "Join me on NomadSafe so we can share real-time location and check-ins on our trip. Download the app and add me as a contact.",
  other:
    "Message from NomadSafe. Please review the details and get in touch if anything looks concerning.",
};

export const smsFallbackStorage = {
  get(purpose: SmsTemplatePurpose): string {
    return storage.getString(key(purpose)) ?? DEFAULT_TEMPLATES[purpose];
  },

  set(purpose: SmsTemplatePurpose, template: string) {
    storage.set(key(purpose), template.trim() || DEFAULT_TEMPLATES[purpose]);
  },

  reset() {
    (Object.keys(DEFAULT_TEMPLATES) as SmsTemplatePurpose[]).forEach((purpose) => {
      storage.remove(key(purpose));
    });
  },
};
