import { useEffect } from "react";
import { useQuery, type FunctionReference } from "convex/react";

/**
 * Subscribes to a Convex query and syncs the result to a Zustand setter.
 * Skips sync when data is undefined (loading or offline).
 */
export function useConvexSync<T>(
  queryRef: FunctionReference<"query">,
  args: Record<string, unknown>,
  setter: (data: T) => void,
) {
  const data = useQuery(queryRef, args) as T | undefined;

  useEffect(() => {
    if (data !== undefined) {
      setter(data);
    }
  }, [data, setter]);

  return { data, isLoading: data === undefined };
}
