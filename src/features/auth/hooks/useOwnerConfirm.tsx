import React, { useCallback, useRef, useState } from "react";
import { PinConfirmSheet } from "../components/PinConfirmSheet";
import { useAuthStore } from "../store/authStore";

interface ConfirmRequest {
  subtitle: string;
  allowBiometric: boolean;
}

/**
 * Asks for the current PIN (or biometrics, when allowed) before a security setting changes.
 * Render `sheet` once; `confirmOwner` resolves true right away when no PIN is set.
 */
export function useOwnerConfirm() {
  const [request, setRequest] = useState<ConfirmRequest>({ subtitle: "", allowBiometric: false });
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState(0);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const confirmOwner = useCallback(
    (next: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        if (!useAuthStore.getState().isPinSet) {
          resolve(true);
          return;
        }
        resolver.current?.(false);
        resolver.current = resolve;
        setRequest(next);
        setRequestId((id) => id + 1);
        setOpen(true);
      }),
    [],
  );

  const finish = (confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOpen(false);
  };

  const sheet = (
    <PinConfirmSheet
      key={requestId}
      visible={open}
      subtitle={request.subtitle}
      allowBiometric={request.allowBiometric}
      onDone={finish}
    />
  );

  return { confirmOwner, sheet };
}
