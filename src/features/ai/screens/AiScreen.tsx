import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useIsFocused, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { ZoomIn, ZoomOut, useAnimatedReaction, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { AuraButton, Icon, LiveDot, PressableScale, showAlert, useAura, type IconName } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { useSettingsStore } from "@/features/settings";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { track } from "@/modules/analytics";
import { TEMP_CHAT_KEY, useChatStore } from "../store/chatStore";
import { useChatConversationKey } from "../hooks/useChatConversationKey";
import { AiChat, HERO_DOCK_DISTANCE } from "../components/AiChat";
import { AiPlasmaOrb } from "../components/AiPlasmaOrb";
import { AiKeySheet } from "../components/AiKeySheet";
import { AiModelsSheet } from "../components/AiModelsSheet";
import { findModel, remoteLabel, useAiAvailability, useAiProvisioning } from "@/modules/ai";
import { provisionPercent } from "../utils/provisionCopy";

const READY = "#3DDC97";
// Lets the models sheet finish closing before the key sheet's modal opens.
const SHEET_SWAP_MS = 260;

function HeaderButton({
  icon,
  label,
  onPress,
  selected = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  selected?: boolean;
}) {
  const { c } = useAura();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={4}
      style={[
        styles.iconButton,
        { backgroundColor: selected ? c.inverse : c.surfaceStrong, borderColor: c.hairline },
      ]}
    >
      <Icon name={icon} size={16} color={selected ? c.onInverse : c.text} strokeWidth={2} />
    </PressableScale>
  );
}

/** AI tab: chat with the on-device model or online AI, with which one answers in the header. */
export default function AiScreen() {
  const { c, f, isDark, accent } = useAura();
  const { t } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const localAiEnabled = useSettingsStore((s) => s.localAiEnabled);
  const provisioning = useAiProvisioning();
  const [modelsOpen, setModelsOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  // Remounts the key sheet on each open so it starts from what's saved.
  const [keySheetSession, setKeySheetSession] = useState(0);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (swapTimer.current) clearTimeout(swapTimer.current);
  }, []);

  const openKeySheet = () => {
    setModelsOpen(false);
    if (swapTimer.current) clearTimeout(swapTimer.current);
    swapTimer.current = setTimeout(() => {
      setKeySheetSession((value) => value + 1);
      setKeyOpen(true);
    }, SHEET_SWAP_MS);
  };
  const focused = useIsFocused();
  const conversationKey = useChatConversationKey();
  const temporary = conversationKey === TEMP_CHAT_KEY;
  const hasMessages = useChatStore((s) => (s.conversations[conversationKey]?.messages.length ?? 0) > 0);
  const setTemporary = useChatStore((s) => s.setTemporary);
  const clearChat = useChatStore((s) => s.clear);
  const generatingHere = useChatStore((s) => s.generatingConversationKey === conversationKey);
  const scrollY = useSharedValue(0);
  const [heroDocked, setHeroDocked] = useState(false);
  useAnimatedReaction(
    () => scrollY.get() > HERO_DOCK_DISTANCE * 0.7,
    (docked, previous) => {
      if (docked !== previous) scheduleOnRN(setHeroDocked, docked);
    },
  );
  const tripName = useTripsStore((s) => s.trips.find((trip) => trip.id === conversationKey)?.name ?? null);

  // Temporary chats only last while the AI tab is open.
  useEffect(() => {
    if (!focused) setTemporary(false);
  }, [focused, setTemporary]);

  const toggleTemporary = () => {
    if (!temporary) track("ai_temporary_chat_started");
    setTemporary(!temporary);
  };

  const confirmClear = () => {
    const body = temporary
      ? t("aiTab.clear.bodyTemporary")
      : tripName
        ? t("aiTab.clear.bodyTrip", { trip: tripName })
        : t("aiTab.clear.bodyGeneral");
    showAlert(t("aiTab.clear.title"), body, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.clear"),
        style: "destructive",
        onPress: () => {
          clearChat(conversationKey);
          track("ai_chat_cleared", { temporary });
        },
      },
    ]);
  };

  const ai = useAiAvailability();
  const onlineName = ai.remote ? remoteLabel(ai.remote, ai.byok, t("aiTab.cloudName")) : null;
  const chatEnabled = localAiEnabled || ai.configured !== null;

  const activeModel = findModel(provisioning.activeModelId);
  const anyDownloaded = activeModel !== null;
  const downloading = provisioning.phase === "downloading" || provisioning.phase === "verifying";
  const ready = provisioning.phase === "ready" || (anyDownloaded && !downloading);
  const waiting = provisioning.phase === "waitingForWifi";
  const pillText = onlineName
    ? t("aiTab.onlinePill", { provider: onlineName })
    : ready
      ? t("aiTab.offlineReady")
      : downloading
        ? t("aiTab.provision.pillDownloading", { percent: provisionPercent(provisioning) })
        : waiting
          ? t("aiTab.provision.waitingForWifiTitle")
          : t("aiTab.noModel");
  const dotColor = onlineName || ready ? READY : downloading ? accent : waiting ? auraStatusAccent.live : c.textMuted;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("tabs.ai")}</Text>
          {chatEnabled && hasMessages && heroDocked ? (
            <Animated.View entering={ZoomIn.springify().damping(14)} exiting={ZoomOut.duration(180)}>
              <AiPlasmaOrb size={24} mode={generatingHere ? "thinking" : "idle"} isDark={isDark} paused={!focused} contained />
            </Animated.View>
          ) : null}
        </View>
        <View style={styles.actions}>
          {chatEnabled ? (
            <HeaderButton
              icon="messageDashed"
              label={t(temporary ? "aiTab.temporary.turnOff" : "aiTab.temporary.turnOn")}
              selected={temporary}
              onPress={toggleTemporary}
            />
          ) : null}
          {chatEnabled && hasMessages ? <HeaderButton icon="trash" label={t("aiTab.clear.action")} onPress={confirmClear} /> : null}
          {localAiEnabled || onlineName ? (
            <PressableScale
              onPress={() => (localAiEnabled ? setModelsOpen(true) : router.push("/settings"))}
              accessibilityRole="button"
              accessibilityLabel={pillText}
              accessibilityHint={t("aiTab.modelTab")}
              style={[styles.chip, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}
            >
              <LiveDot color={dotColor} size={7} active={downloading && !onlineName} />
              <Text numberOfLines={1} style={[styles.chipText, { color: c.text, fontFamily: f.medium }]}>
                {pillText}
              </Text>
              <Icon name="chevronDown" size={13} color={c.textMuted} strokeWidth={2} />
            </PressableScale>
          ) : null}
        </View>
      </View>

      {chatEnabled ? (
        <>
          <AiChat
            activeModelName={localAiEnabled ? (activeModel?.name ?? null) : null}
            scrollY={scrollY}
            heroDocked={heroDocked && hasMessages}
          />
          <AiModelsSheet visible={modelsOpen} onClose={() => setModelsOpen(false)} onOpenKey={openKeySheet} />
          <AiKeySheet key={keySheetSession} visible={keyOpen} onClose={() => setKeyOpen(false)} />
        </>
      ) : (
        <View style={styles.disabled}>
          <View style={[styles.disabledIcon, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="sparkle" size={24} color={c.textSoft} strokeWidth={2} />
          </View>
          <Text style={[styles.disabledTitle, { color: c.text, fontFamily: f.semibold }]}>{t("aiTab.disabledTitle")}</Text>
          <Text style={[styles.disabledBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("aiTab.disabledBody")}</Text>
          <AuraButton label={t("aiTab.disabledAction")} icon="settings" size="md" onPress={() => router.push("/settings")} style={styles.disabledButton} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 34, letterSpacing: -1.2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 1,
  },
  chipText: { fontSize: 13.5, flexShrink: 1, fontVariant: ["tabular-nums"] },
  disabled: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, paddingBottom: 120, gap: 10 },
  disabledIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  disabledTitle: { fontSize: 22, letterSpacing: -0.6, textAlign: "center" },
  disabledBody: { fontSize: 14.5, lineHeight: 21, textAlign: "center" },
  disabledButton: { marginTop: 10 },
});
