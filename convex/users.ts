import type { GenericCtx } from "@convex-dev/better-auth";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";

export interface AppUser {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
}

type AuthUserDoc = {
  _id: string;
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Better Auth ids: legacy docs carry `userId`, newer ones use `_id`. */
export function authUserId(user: { _id: string; userId?: string | null }) {
  return user.userId ?? user._id;
}

function toAppUser(doc: AuthUserDoc): AppUser {
  return {
    id: authUserId(doc),
    name: doc.name ?? "",
    email: doc.email ?? null,
    image: doc.image ?? null,
  };
}

export async function getAuthenticatedUser(ctx: GenericCtx<DataModel>): Promise<AppUser | null> {
  const user = await authComponent.safeGetAuthUser(ctx);
  return user ? toAppUser(user as unknown as AuthUserDoc) : null;
}

export async function requireUser(ctx: GenericCtx<DataModel>): Promise<AppUser> {
  const user = await getAuthenticatedUser(ctx);
  if (!user) throw new Error("Not authenticated");
  return user;
}

/** Looks up a Better Auth user by email in the auth component's tables. */
export async function findAuthUserByEmail(
  ctx: QueryCtx | MutationCtx,
  email: string,
): Promise<AppUser | null> {
  const doc = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "email", operator: "eq", value: normalizeEmail(email) }],
  })) as AuthUserDoc | null;
  return doc ? toAppUser(doc) : null;
}

export async function findAuthUserById(
  ctx: QueryCtx | MutationCtx,
  id: string,
): Promise<AppUser | null> {
  const doc = (await authComponent.getAnyUserById(ctx, id)) as unknown as AuthUserDoc | null;
  return doc ? toAppUser(doc) : null;
}
