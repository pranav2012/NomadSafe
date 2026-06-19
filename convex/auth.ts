import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { expo } from "@better-auth/expo";
import { phoneNumber } from "better-auth/plugins";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const SITE_URL = process.env.SITE_URL;
const BASE_URL = process.env.BETTER_AUTH_URL || SITE_URL;

if (!BASE_URL) {
  throw new Error(
    "Missing SITE_URL or BETTER_AUTH_URL environment variable. Set it with: npx convex env set SITE_URL <url>",
  );
}

export const authComponent = createClient<DataModel>(components.betterAuth);

/** Creates a Better Auth instance bound to a Convex request context */
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  return betterAuth({
    baseURL: BASE_URL,
    trustedOrigins: ["nomadsafe://", SITE_URL].filter(Boolean) as string[],
    database: authComponent.adapter(ctx),
    socialProviders: {
      ...(googleClientId && googleClientSecret
        ? {
            google: {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
            },
          }
        : {}),
    },
    plugins: [
      expo(),
      convex({ authConfig }),
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        sendOTP: async ({ phoneNumber: phone, code }) => {
          // TODO: Integrate SMS provider (Twilio, etc.)
          console.log(`OTP for ${phone}: ${code}`);
        },
        signUpOnVerification: {
          getTempEmail: (phone) => `${phone}@phone.nomadsafe.app`,
          getTempName: (phone) => phone,
        },
      }),
    ],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});
