import * as Keychain from "react-native-keychain";

const PIN_SERVICE = "nomadsafe-pin";

export const secureStorage = {
  async setPin(hashedPin: string): Promise<void> {
    await Keychain.setGenericPassword("pin", hashedPin, {
      service: PIN_SERVICE,
    });
  },

  async getPin(): Promise<string | null> {
    const result = await Keychain.getGenericPassword({ service: PIN_SERVICE });
    return result ? result.password : null;
  },

  async hasPin(): Promise<boolean> {
    const result = await Keychain.getGenericPassword({ service: PIN_SERVICE });
    return !!result;
  },

  async resetPin(): Promise<void> {
    await Keychain.resetGenericPassword({ service: PIN_SERVICE });
  },
};
