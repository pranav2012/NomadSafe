let open = 0;

/**
 * Runs a call that shows system UI (Face ID, permission, purchase or sign-in sheets). iOS reports the
 * app inactive meanwhile; the app-switcher cover (usePrivacyShield) skips that, so it doesn't flash.
 */
export async function withSystemPrompt<T>(run: () => Promise<T>): Promise<T> {
  open += 1;
  try {
    return await run();
  } finally {
    open -= 1;
  }
}

export const isSystemPromptOpen = () => open > 0;
