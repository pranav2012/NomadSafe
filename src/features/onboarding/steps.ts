export const ONBOARDING_STEPS = ["welcome", "safety", "onDevice", "lock"] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

/** The final step: PIN and biometrics, then the setup recap. PIN setup returns here. */
export const ONBOARDING_LOCK_STEP = ONBOARDING_STEPS.indexOf("lock");
