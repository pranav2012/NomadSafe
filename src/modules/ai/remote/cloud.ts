import { api, backendSiteUrl, convex, ConvexError, getConvexJwt } from "@/modules/backend";
import { getAppCheckToken, withAppCheck } from "@/modules/appCheck";
import type { AiTask, CloudQuota } from "../policy";
import type { JsonTask } from "../schemas";
import { RemoteAiError, postStream } from "./http";
import type { RemoteMessage } from "./providers";

// Monthly allowance per kind that the server reported as used up; skipped until the month changes.
const exhausted: Partial<Record<CloudQuota, string>> = {};

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function isCloudExhausted(kind: CloudQuota) {
  return exhausted[kind] === currentMonth();
}

export function clearCloudExhaustion() {
  delete exhausted.chat;
  delete exhausted.tasks;
}

function noteFailure(kind: CloudQuota, code: string | undefined) {
  if (code === "quota") exhausted[kind] = currentMonth();
}

/** Runs one structured task on NomadSafe Cloud; `task` picks the per-feature counter on the server. */
export async function cloudCompleteJson(task: AiTask, system: string, prompt: string, schema: JsonTask): Promise<string> {
  if (task === "chat" || task === "expenseCategory") throw new RemoteAiError(`${task} can't use cloud tasks`);
  try {
    const args = await withAppCheck({ system, prompt, schemaName: schema.name, schema: schema.schema, task });
    return await convex.action(api.ai.complete, args);
  } catch (error) {
    const code = error instanceof ConvexError ? (error.data as { code?: string })?.code : undefined;
    noteFailure("tasks", code);
    throw new RemoteAiError(code ?? "cloud task failed", undefined, code);
  }
}

/** Streams a reply from NomadSafe Cloud; `onText` gets the accumulated text. */
export async function cloudChat(messages: RemoteMessage[], onText: (accumulated: string) => void, signal?: AbortSignal): Promise<string> {
  const jwt = await getConvexJwt();
  if (!jwt || !backendSiteUrl) throw new RemoteAiError("not signed in", 401, "unauthenticated");
  const appCheckToken = await getAppCheckToken();
  let text = "";
  try {
    await postStream(
      {
        url: `${backendSiteUrl}/ai/chat`,
        headers: {
          Authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
          ...(appCheckToken ? { "X-Firebase-AppCheck": appCheckToken } : {}),
        },
        body: JSON.stringify({ messages, task: "chat" }),
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
