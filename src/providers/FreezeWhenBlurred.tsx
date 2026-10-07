import React, { Suspense, use, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Platform } from "react-native";
import { useIsFocused } from "expo-router";

// Long enough for the screen to render its blurred state (paused animations) before it freezes.
const FREEZE_DELAY_MS = 400;

type Pending = { promise: Promise<void>; resolve: () => void };

function makePending(): Pending {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Suspends while `pending` is set, so its subtree keeps its state but stops re-rendering. */
function Suspender({ pending, children }: { pending: Pending | null; children: ReactNode }) {
  if (pending) use(pending.promise);
  return children;
}

/**
 * Freezes a hidden tab on iOS (as Android's `freezeOnBlur` does): store and Convex updates stop
 * re-rendering it until it's focused again. Unfreezes in the same render that it regains focus.
 */
function FreezeWhenBlurred({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    if (focused) return;
    const timer = setTimeout(() => setPending(makePending()), FREEZE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focused]);
  if (focused && pending) {
    pending.resolve();
    setPending(null);
  }
  return (
    <Suspense fallback={null}>
      <Suspender pending={focused ? null : pending}>{children}</Suspender>
    </Suspense>
  );
}

/** Wraps a tab screen so it freezes while hidden on iOS; Android tabs freeze in the tabs layout. */
export function freezeWhenBlurred<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  if (Platform.OS !== "ios") return Screen;
  function FrozenWhenBlurred(props: P) {
    return (
      <FreezeWhenBlurred>
        <Screen {...props} />
      </FreezeWhenBlurred>
    );
  }
  return FrozenWhenBlurred;
}
