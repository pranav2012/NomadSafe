export type CoalescerBackend = {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  remove(name: string): void;
};

export type CoalescerOptions = {
  delayMs: number;
  /** False writes through at once (e.g. headless or backgrounded, where the process may die soon). */
  shouldDefer: () => boolean;
  schedule?: (run: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
};

/**
 * Holds the latest value per key and writes them all at most once per `delayMs`, so a burst of store
 * updates becomes one write per key. Reads see pending values; removals go straight through.
 */
export function createWriteCoalescer(backend: CoalescerBackend, options: CoalescerOptions) {
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const pending = new Map<string, string>();
  let timer: unknown = null;

  function flush() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    const entries = [...pending];
    pending.clear();
    for (const [name, value] of entries) backend.set(name, value);
  }

  return {
    getItem(name: string): string | null {
      if (pending.has(name)) return pending.get(name)!;
      return backend.get(name) ?? null;
    },
    setItem(name: string, value: string) {
      if (!options.shouldDefer()) {
        pending.delete(name);
        backend.set(name, value);
        return;
      }
      pending.set(name, value);
      if (timer === null) {
        timer = schedule(() => {
          timer = null;
          flush();
        }, options.delayMs);
      }
    },
    removeItem(name: string) {
      pending.delete(name);
      backend.remove(name);
    },
    flush,
    discard() {
      if (timer !== null) cancel(timer);
      timer = null;
      pending.clear();
    },
    hasPending: () => pending.size > 0,
  };
}
