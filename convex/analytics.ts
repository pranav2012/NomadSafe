import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const POSTHOG_API_HOST = "https://eu.posthog.com";
const MAX_ATTEMPTS = 6;
const RETRY_BASE_MS = 5 * 60_000;

// The app keeps sending with the old ID until its wipe finishes; waiting lets those events land first.
export const POSTHOG_DELETE_DELAY_MS = 60 * 60_000;

type BulkDeleteResponse = {
  persons_found?: number;
  deletion_errors?: unknown[];
};

/** Deletes a user's PostHog person, events and recordings, retrying with backoff. */
export const deletePostHogPerson = internalAction({
  args: { distinctId: v.string(), attempt: v.number() },
  handler: async (ctx, { distinctId, attempt }) => {
    const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
    const projectId = process.env.POSTHOG_PROJECT_ID;
    if (!apiKey || !projectId) {
      console.warn("[posthog-delete] POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID not set; skipping");
      return;
    }

    let failure: string | null = null;
    try {
      const res = await fetch(
        `${POSTHOG_API_HOST}/api/projects/${encodeURIComponent(projectId)}/persons/bulk_delete/`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            distinct_ids: [distinctId],
            delete_events: true,
            delete_recordings: true,
          }),
        },
      );
      if (!res.ok) {
        failure = `HTTP ${res.status}`;
      } else {
        const body = (await res.json().catch(() => ({}))) as BulkDeleteResponse;
        if (body.deletion_errors?.length) failure = `${body.deletion_errors.length} deletion error(s)`;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : "network error";
    }

    if (!failure) return;
    if (attempt + 1 >= MAX_ATTEMPTS) {
      console.error(`[posthog-delete] gave up after ${MAX_ATTEMPTS} attempts: ${failure}`);
      return;
    }
    console.warn(`[posthog-delete] attempt ${attempt + 1} failed (${failure}); retrying`);
    await ctx.scheduler.runAfter(RETRY_BASE_MS * 2 ** attempt, internal.analytics.deletePostHogPerson, {
      distinctId,
      attempt: attempt + 1,
    });
  },
});
