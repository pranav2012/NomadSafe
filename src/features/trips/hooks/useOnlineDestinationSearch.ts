import { useCallback, useEffect, useRef, useState } from "react";
import { api, convex } from "@/modules/backend";
import { withAppCheck } from "@/modules/appCheck";
import { type DestinationOption, foldSearchText } from "@/features/trips/data/destinations";
import { type LatLng, rememberDestination } from "@/features/trips/services/geocoding";

const DEBOUNCE_MS = 250;
/** Enough offline matches means the user is likely to find it there; skip the paid lookup. */
const MIN_OFFLINE_MATCHES = 3;

type Status = "idle" | "loading" | "done" | "error";

const newSessionToken = () =>
  Array.from({ length: 32 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

/**
 * Debounced Google suggestions (through our server) when offline cities run short. One session
 * token covers a search until a pick, so the typing requests are billed as the single details call.
 */
export function useOnlineDestinationSearch(query: string, offlineCount: number, locale: string) {
  const [state, setState] = useState<{ query: string; status: Status; results: DestinationOption[] }>({
    query: "",
    status: "idle",
    results: [],
  });
  const cacheRef = useRef(new Map<string, DestinationOption[]>());
  const sessionRef = useRef<string | null>(null);

  const folded = foldSearchText(query);
  const wanted = folded.length >= 2 && offlineCount < MIN_OFFLINE_MATCHES;

  useEffect(() => {
    if (!wanted) return;
    const cacheKey = `${locale}|${folded}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setState({ query: folded, status: "done", results: cached });
      return;
    }

    let cancelled = false;
    setState((current) => ({ query: folded, status: "loading", results: current.results }));
    const timer = setTimeout(() => {
      sessionRef.current ??= newSessionToken();
      withAppCheck({ input: folded, sessionToken: sessionRef.current, language: locale })
        .then((args) => convex.action(api.places.autocompleteDestinations, args))
        .then((suggestions) => {
          const results = suggestions.map(({ placeId, label }) => ({ id: `online-${placeId}`, label, kind: "online" as const, placeId }));
          cacheRef.current.set(cacheKey, results);
          if (!cancelled) setState({ query: folded, status: "done", results });
        })
        .catch(() => {
          if (!cancelled) setState({ query: folded, status: "error", results: [] });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [folded, locale, wanted]);

  /** Starts the coordinate lookup for a picked online result and closes the session. */
  const choose = useCallback((option: DestinationOption) => {
    if (option.coordinates) rememberDestination(option.label, option.coordinates);
    else if (option.placeId && sessionRef.current) {
      const lookup: Promise<LatLng | null> = withAppCheck({ placeId: option.placeId, sessionToken: sessionRef.current }).then(
        (args) => convex.action(api.places.resolveDestination, args),
      );
      rememberDestination(option.label, lookup);
    }
    sessionRef.current = null;
  }, []);

  const current = wanted && state.query === folded;
  return {
    results: current ? state.results : [],
    status: current ? state.status : ("idle" as Status),
    choose,
  };
}
