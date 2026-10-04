import type { ByokSummary } from "../services/remote/byok";
import type { ByokProvider } from "../services/remote/providers";
import type { RemoteAiRoute } from "../hooks/useAiAvailability";

const PROVIDER_NAMES: Record<Exclude<ByokProvider, "openai_compatible">, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
};

export function byokProviderName(summary: Pick<ByokSummary, "provider" | "baseUrl">): string {
  if (summary.provider !== "openai_compatible") return PROVIDER_NAMES[summary.provider];
  try {
    return new URL(summary.baseUrl ?? "").host || "API";
  } catch {
    return "API";
  }
}

/** Who answers online: the user's provider, or NomadSafe Cloud (Pro). */
export function remoteLabel(route: RemoteAiRoute, byok: ByokSummary | null, cloudName: string): string {
  return route === "byok" && byok ? byokProviderName(byok) : cloudName;
}
