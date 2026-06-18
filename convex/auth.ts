import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { expo } from "@better-auth/expo";
import { phoneNumber } from "better-auth/plugins";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

export const authComponent = createClient<DataModel>(components.betterAuth);

/** Creates a Better Auth instance bound to a Convex request context */
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    trustedOrigins: ["nomadsafe://"],
    database: authComponent.adapter(ctx),
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
      apple: {
        clientId: process.env.APPLE_CLIENT_ID!,
        clientSecret: process.env.APPLE_CLIENT_SECRET!,
      },
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
