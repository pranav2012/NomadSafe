export const ONBOARDING_STEPS = ["safety", "onDevice"] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];
