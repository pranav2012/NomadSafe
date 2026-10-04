import { credentials } from "@/modules/storage";

const PIN_SERVICE = "nomadsafe-pin";

export const secureStorage = {
  async setPin(hashedPin: string): Promise<void> {
    await credentials.set(PIN_SERVICE, hashedPin);
  },

  async getPin(): Promise<string | null> {
    return credentials.get(PIN_SERVICE);
  },

  async hasPin(): Promise<boolean> {
    return (await credentials.get(PIN_SERVICE)) !== null;
  },

  async resetPin(): Promise<void> {
    await credentials.remove(PIN_SERVICE);
  },
};
