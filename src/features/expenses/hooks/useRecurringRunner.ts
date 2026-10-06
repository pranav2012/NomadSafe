import { useEffect } from "react";
import { AppState } from "react-native";
import { runRecurring } from "@/features/expenses/services/recurringRunner";

/** Adds due recurring spends on launch and whenever the app comes back. Mount once in the tabs layout. */
export function useRecurringRunner() {
  useEffect(() => {
    runRecurring();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") runRecurring();
    });
    return () => subscription.remove();
  }, []);
}
