import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { convex } from "@/services/convex";
import { getConvexJwt } from "@/features/auth/services/convexJwt";
import type { JsonTask } from "../aiSchemas";
import { RemoteAiError, postStream } from "./http";
import type { RemoteMessage } from "./providers";

const siteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;

export type CloudKind = "chat" | "tasks";

// Monthly allowance per kind that the server reported as used up; skipped until the month changes.
const exhausted: Partial<Record<CloudKind, string>> = {};

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function isCloudExhausted(kind: CloudKind) {
  return exhausted[kind] === currentMonth();
}

export function clearCloudExhaustion() {
  delete exhausted.chat;
  delete exhausted.tasks;
}

function noteFailure(kind: CloudKind, code: string | undefined) {
  if (code === "quota") exhausted[kind] = currentMonth();
}

export async function cloudCompleteJson(system: string, prompt: string, task: JsonTask): Promise<string> {
  try {
    return await convex.action(api.ai.complete, { system, prompt, schemaName: task.name, schema: task.schema });
  } catch (error) {
    const code = error instanceof ConvexError ? (error.data as { code?: string })?.code : undefined;
    noteFailure("tasks", code);
    throw new RemoteAiError(code ?? "cloud task failed", undefined, code);
  }
}

/** Streams a reply from NomadSafe Cloud; `onText` gets the accumulated text. */
export async function cloudChat(messages: RemoteMessage[], onText: (accumulated: string) => void, signal?: AbortSignal): Promise<string> {
  const jwt = await getConvexJwt();
  if (!jwt || !siteUrl) throw new RemoteAiError("not signed in", 401, "unauthenticated");
  let text = "";
  try {
    await postStream(
      {
        url: `${siteUrl}/ai/chat`,
        headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      },
      (chunk) => {
        text += chunk;
        onText(text);
      },
      signal,
    );
  } catch (error) {
    if (error instanceof RemoteAiError) noteFailure("chat", error.code);
    throw error;
  }
  return text;
}
