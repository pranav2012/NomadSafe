/** Public API of the AI module; app code imports AI only from here. Routing rules live in `policy.ts`. */
export { aiService, mayUseOnlineAi } from "./router";
export { aiRuntime } from "./runtime";
export {
  AI_TASK_ROUTES,
  BYOK_PROVIDER_DEFAULTS,
  CLOUD_MODEL,
  type AiProvider,
  type AiTask,
  type ByokProvider,
  type RemoteProvider,
} from "./policy";
export {
  EXPENSE_CATEGORY_VALUES,
  type ChatOptions,
  type ChatTurn,
  type ExpenseCategoryId,
  type ExpenseCategoryInput,
  type ItineraryEventRefinement,
  type ItineraryEventRefinementInput,
  type TripBudgetEstimate,
  type TripBudgetEstimateInput,
  type TripNameInput,
  type TripNameSuggestion,
} from "./prompts";
export { clearByokConfig, getByokConfig, saveByokConfig, testByokConfig, useByokStore, type ByokSummary } from "./remote/byok";
export { clearCloudExhaustion } from "./remote/cloud";
export { RemoteAiError } from "./remote/http";
export { isConfigComplete as isByokConfigComplete, type ByokConfig } from "./remote/providers";
export { byokProviderName, remoteLabel } from "./labels";
export { useAiAvailability } from "./hooks/useAiAvailability";
export { useAiSources, type AiSource } from "./hooks/useAiSources";
export { resetAiPreference, setPreferredAiSource, useAiPreferenceStore } from "./preference";
export { useAiProvisioning, useAiReadyModelId, type AiProvisioning } from "./hooks/useAiProvisioning";
export { AI_MODELS, findModel, formatBytes, formatModelSize, type AiModel, type AiModelId } from "./local/aiModelService";
export { modelNotifications } from "./local/modelNotifications";
export {
  useProvisioningStore,
  type ProvisionErrorCode,
  type ProvisionPhase,
  type ProvisioningState,
} from "./local/modelProvisioner";
