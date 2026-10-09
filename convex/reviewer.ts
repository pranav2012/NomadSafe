import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { createAuth } from "./auth";
import { normalizeEmail } from "./users";

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function randomPassword(length = 20) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]).join("");
}

/**
 * Creates the email/password account app reviewers sign in with (tap the "Nomad Safe" title
 * on the sign-in screen 10 times), or gives it a new password, and grants it Pro until revoked. Returns the password once:
 * `npx convex run --prod reviewer:createReviewer '{"email":"review@example.com"}'`.
 */
export const createReviewer = internalAction({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ email: string; password: string; userId: string }> => {
    const email = normalizeEmail(args.email);
    const auth = createAuth(ctx);
    const authCtx = await auth.$context;
    const password = randomPassword();
    const hash = await authCtx.password.hash(password);

    const found = await authCtx.internalAdapter.findUserByEmail(email, { includeAccounts: true });
    let userId: string;
    if (found) {
      userId = found.user.id;
      if (found.accounts.some((account) => account.providerId === "credential")) {
        await authCtx.internalAdapter.updatePassword(userId, hash);
      } else {
        await authCtx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
      }
    } else {
      const user = await authCtx.internalAdapter.createUser({ email, name: args.name ?? "App Reviewer", emailVerified: true });
      userId = user.id;
      await authCtx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
    }

    await ctx.runMutation(internal.billing.grantPlan, { userId, tier: "pro", note: "app store review" });
    return { email, password, userId };
  },
});
