import React, { useState } from "react";
import { AccessibilityInfo, Modal, Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeInUp, FadeOutUp } from "react-native-reanimated";
import { FullWindowOverlay } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { Icon } from "@/atoms/nomad/Icon";
import { translate } from "@/localization/translate";
import { AuraButton, type AuraButtonVariant } from "./AuraButton";
import { useAura } from "./useAura";

export interface AuraAlertButton {
  text?: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

interface PendingAlert {
  id: number;
  title: string;
  message?: string;
  buttons: AuraAlertButton[];
}

interface Toast {
  id: number;
  title: string;
  message?: string;
}

const TOAST_MS = 2800;


const useAlertStore = create<{ queue: PendingAlert[]; toast: Toast | null }>(() => ({ queue: [], toast: null }));
let nextId = 1;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Drop-in for `Alert.alert`, drawn as an Aura dialog. Alerts queue up, and a button's `onPress`
 * runs after its dialog closes, so it can navigate or open the next alert.
 */
export function showAlert(title: string, message?: string, buttons?: AuraAlertButton[]) {
  const list = buttons && buttons.length > 0 ? buttons : [{ text: translate("common.ok") }];
  useAlertStore.setState((state) => ({
    queue: [...state.queue, { id: nextId++, title, message, buttons: list }],
  }));
}

/** A short confirmation that fades out on its own; never use it for errors or questions. */
export function showToast(title: string, message?: string) {
  if (toastTimer) clearTimeout(toastTimer);
  useAlertStore.setState({ toast: { id: nextId++, title, message } });
  AccessibilityInfo.announceForAccessibility(message ? `${title}. ${message}` : title);
  toastTimer = setTimeout(() => {
    toastTimer = null;
    useAlertStore.setState({ toast: null });
  }, TOAST_MS);
}

function dismiss(alert: PendingAlert, button?: AuraAlertButton) {
  useAlertStore.setState((state) => ({
    queue: state.queue.filter((item) => item.id !== alert.id),
  }));
  button?.onPress?.();
}

/** Renders queued alerts and toasts; mount once, after every other modal, at the app root. */
export function AuraAlertHost() {
  const alert = useAlertStore((s) => s.queue[0] ?? null);
  const toast = useAlertStore((s) => s.toast);
  return (
    <>
      <AlertDialog alert={alert} />
      <ToastOverlay toast={toast} />
    </>
  );
}

function variantFor(button: AuraAlertButton, primaryUsed: boolean): AuraButtonVariant {
  if (button.style === "destructive") return "danger";
  if (button.style === "cancel") return "ghost";
  return primaryUsed ? "secondary" : "primary";
}

function AlertDialog({ alert }: { alert: PendingAlert | null }) {
  const { c, f } = useAura();
  const { width } = useWindowDimensions();
  // Keeps the last alert on screen while the modal fades out.
  const [shown, setShown] = useState(alert);
  if (alert && alert !== shown) setShown(alert);

  const cancel = shown?.buttons.find((button) => button.style === "cancel");
  // Actions first, cancel last, so the safe choice sits at the bottom like a sheet.
  const ordered = shown ? [...shown.buttons.filter((button) => button.style !== "cancel"), ...(cancel ? [cancel] : [])] : [];
  let primaryUsed = false;

  return (
    <Modal
      visible={alert !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        if (alert && cancel) dismiss(alert, cancel);
      }}
    >
      <View style={styles.backdrop}>
        {shown ? (
          <Animated.View
            key={shown.id}
            entering={FadeIn.duration(140)}
            accessibilityViewIsModal
            accessibilityRole="alert"
            style={[
              styles.card,
              {
                width: Math.min(width - 48, 400),
                backgroundColor: c.card,
                borderColor: c.hairline,
              },
            ]}
          >
            <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{shown.title}</Text>
            {shown.message ? <Text style={[styles.message, { color: c.textSoft, fontFamily: f.regular }]}>{shown.message}</Text> : null}
            <View style={styles.buttons}>
              {ordered.map((button, index) => {
                const variant = variantFor(button, primaryUsed);
                if (variant === "primary") primaryUsed = true;
                return (
                  <AuraButton
                    key={`${index}-${button.text}`}
                    label={button.text ?? translate("common.ok")}
                    variant={variant}
                    onPress={() => alert && dismiss(alert, button)}
                    pressedScale={1}
                    style={styles.button}
                  />
                );
              })}
            </View>
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

function ToastOverlay({ toast }: { toast: Toast | null }) {
  const { c, f } = useAura();
  const insets = useSafeAreaInsets();

  const content = (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { paddingTop: insets.top + 8 }]}>
      {toast ? (
        <Animated.View
          key={toast.id}
          entering={FadeInUp.duration(220)}
          exiting={FadeOutUp.duration(180)}
          accessibilityLiveRegion="polite"
          style={[styles.toast, { backgroundColor: c.card, borderColor: c.hairline }]}
        >
          <View style={styles.toastIcon}>
            <Icon name="check" size={14} color="#FFFFFF" strokeWidth={2.6} />
          </View>
          <View style={styles.toastText}>
            <Text numberOfLines={2} style={[styles.toastTitle, { color: c.text, fontFamily: f.semibold }]}>
              {toast.title}
            </Text>
            {toast.message ? (
              <Text numberOfLines={3} style={[styles.toastMessage, { color: c.textSoft, fontFamily: f.regular }]}>
                {toast.message}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
  // iOS modal screens sit in their own window; the overlay keeps toasts above them.
  return Platform.OS === "ios" ? <FullWindowOverlay>{content}</FullWindowOverlay> : content;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(4,6,10,0.62)",
  },
  card: {
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 16,
  },
  title: { fontSize: 19, letterSpacing: -0.3, lineHeight: 25 },
  message: { fontSize: 15, lineHeight: 21.5, marginTop: 8 },
  buttons: { marginTop: 22, gap: 6 },
  button: { height: 48 },
  toast: {
    alignSelf: "center",
    maxWidth: 420,
    marginHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 18,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  toastIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#22C7B8",
  },
  toastText: { flexShrink: 1 },
  toastTitle: { fontSize: 14.5 },
  toastMessage: { fontSize: 13, lineHeight: 18, marginTop: 1 },
});
