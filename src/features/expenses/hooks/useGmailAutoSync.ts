import { useEffect, useState } from "react";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import {
  buildImportCandidates,
  candidateToInput,
} from "@/features/expenses/services/importPipeline";
import { useGmailImport } from "@/features/expenses/hooks/useGmailImport";
import type { Trip } from "@/features/trips/store/tripsStore";
import { track } from "@/services/analytics";

// Succeeds once per app session; a failed attempt retries on the next trigger.
let sessionSynced = false;
let syncInFlight = false;

export interface GmailAutoSync {
  importedCount: number | null;
  dismiss: () => void;
}

/**
 * On launch, if Gmail is connected, silently fetches recent transaction emails
 * and adds any new (non-duplicate) spends to the ledger. Categorization uses the
 * keyword heuristic only, so it never loads the local model at startup. Returns
 * the count of newly added spends so the screen can show a banner.
 */
export function useGmailAutoSync(trip: Trip | null): GmailAutoSync {
  const gmail = useGmailImport();
  const addExpenses = useExpensesStore((state) => state.addExpenses);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!trip || sessionSynced || syncInFlight || !gmail.connected) return;
    syncInFlight = true;

    let mounted = true;
    (async () => {
      try {
        const { messages, fetchedAt } = await gmail.fetchEmails({ trip });
        const candidates = await buildImportCandidates(messages, "email", {
          allowModel: false,
          trip,
        });
        const fresh = candidates.filter((candidate) => !candidate.duplicate);
        if (fresh.length > 0) {
          const inputs = await Promise.all(
            fresh.map((candidate) => candidateToInput(candidate, trip.id, trip.currency)),
          );
          const added = addExpenses(inputs);
          if (added.length > 0) track("expense_added", { source: "gmail_auto", count: added.length });
          if (mounted && added.length > 0) setImportedCount(added.length);
        }
        // Checkpoint only after the spends are saved so a failure rescans them.
        await gmail.completeSync(fetchedAt);
        sessionSynced = true;
      } catch {
        // Background sync is best-effort; failures stay silent.
      } finally {
        syncInFlight = false;
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmail.connected, trip]);

  return { importedCount, dismiss: () => setImportedCount(null) };
}
