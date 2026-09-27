import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalization } from "@/localization";
import { type DestinationOption, normalizeSearchText } from "@/features/trips/data/destinations";
import { nominatimSearch } from "@/features/trips/services/geocoding";

interface WebDestinationResult {
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    country?: string;
  };
}

function formatWebDestination(result: WebDestinationResult) {
  const city =
    result.address?.city ??
    result.address?.town ??
    result.address?.village ??
    result.address?.municipality;
  const parts = [city, result.address?.state, result.address?.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : result.display_name.split(",").slice(0, 3).join(",");
}

/** Tap-to-search web lookup (Nominatim forbids client autocomplete); stale responses are dropped. */
export function useWebDestinationSearch(selectedDestinations: string[]) {
  const { t, locale } = useLocalization();
  const [results, setResults] = useState<DestinationOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setResults([]);
    setError(null);
    setIsSearching(false);
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const search = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (query.length < 2 || controllerRef.current) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsSearching(true);
      setError(null);

      try {
        const response = await nominatimSearch<WebDestinationResult[]>(
          {
            q: query,
            format: "jsonv2",
            addressdetails: "1",
            limit: "8",
            "accept-language": locale,
          },
          controller.signal,
        );
        if (requestId !== requestIdRef.current) return;

        const selectedSet = new Set(selectedDestinations.map(normalizeSearchText));
        const seen = new Set<string>();
        const options = response
          .map((result) => formatWebDestination(result).trim())
          .filter((label) => {
            const key = normalizeSearchText(label);
            if (!label || selectedSet.has(key) || seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((label, index) => ({
            id: `web-${index}-${label}`,
            label,
            detail: t("trip.webResult"),
          }));

        setResults(options);
        if (options.length === 0) setError(t("trip.noDestinationResults"));
      } catch {
        if (requestId === requestIdRef.current) setError(t("trip.destinationSearchError"));
      } finally {
        if (requestId === requestIdRef.current) {
          controllerRef.current = null;
          setIsSearching(false);
        }
      }
    },
    [locale, selectedDestinations, t],
  );

  return { results, isSearching, error, search, reset };
}
