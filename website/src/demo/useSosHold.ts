import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export const SOS_HOLD_MS = 2000;
export const SOS_COUNTDOWN_S = 5;

export type SosPhase = { kind: "idle" } | { kind: "holding" } | { kind: "countdown"; seconds: number } | { kind: "done" } | { kind: "cancelled" };

/**
 * The app's hold-to-SOS timing (2 s hold, then a 5 s cancel countdown) as local state only.
 * `progress` (0..1) is written straight to the ring element so holding doesn't re-render each frame.
 */
export function useSosHold(onProgress: (fraction: number) => void, announce: (text: string) => void) {
  const [phase, setPhase] = useState<SosPhase>({ kind: "idle" });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const raf = useRef(0);
  const start = useRef(0);

  const stop = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  };

  const begin = useCallback(() => {
    const kind = phaseRef.current.kind;
    if (kind === "holding" || kind === "countdown") return;
    setPhase({ kind: "holding" });
    announce("Keep holding");
    start.current = performance.now();
    const tick = (now: number) => {
      const fraction = Math.min(1, (now - start.current) / SOS_HOLD_MS);
      onProgress(fraction);
      if (fraction >= 1) {
        raf.current = 0;
        setPhase({ kind: "countdown", seconds: SOS_COUNTDOWN_S });
        announce(`Demo: sending SOS in ${SOS_COUNTDOWN_S}. Nothing is sent.`);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [announce, onProgress]);

  const release = useCallback(() => {
    if (phaseRef.current.kind !== "holding") return;
    stop();
    onProgress(0);
    setPhase({ kind: "cancelled" });
    announce("Released early. Cancelled.");
  }, [announce, onProgress]);

  const cancel = useCallback(() => {
    onProgress(0);
    setPhase({ kind: "cancelled" });
    announce("SOS cancelled. Nothing was sent.");
  }, [announce, onProgress]);

  const reset = useCallback(() => {
    onProgress(0);
    setPhase({ kind: "idle" });
  }, [onProgress]);

  useEffect(() => {
    if (phase.kind !== "countdown") return;
    const timer = window.setTimeout(() => {
      if (phase.seconds > 1) {
        setPhase({ kind: "countdown", seconds: phase.seconds - 1 });
        announce(String(phase.seconds - 1));
      } else {
        onProgress(0);
        setPhase({ kind: "done" });
        announce("Demo finished. In the app your circle would get a push notification now. Nothing was sent.");
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [phase, announce, onProgress]);

  useEffect(() => () => stop(), []);

  const buttonProps = {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      begin();
    },
    onPointerUp: release,
    onPointerCancel: release,
    onBlur: release,
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) {
        e.preventDefault();
        begin();
      }
    },
    onKeyUp: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        release();
      }
    },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };

  return { phase, cancel, reset, buttonProps };
}
