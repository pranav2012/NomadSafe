import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  type ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BlurTargetView } from "expo-blur";
import Animated, {
  Extrapolation,
  FadeIn,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { AuraCard, AuraOptionSheet, Icon, PressableScale, useAura, useTabBarInset } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { useChatStore, useChatStreamStore } from "../store/chatStore";
import { useChatContext, useChatConversationKey } from "../hooks/useChatConversationKey";
import { GENERAL_CONTEXT, OVERVIEW_CONTEXT } from "../services/chatContext";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { aiRuntime, modelNotifications, remoteLabel, useAiAvailability, useAiProvisioning, useAiSources } from "@/modules/ai";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { provisionUnavailableText } from "../utils/provisionCopy";
import { AiComposer } from "./AiComposer";
import { AiMessage } from "./AiMessage";
import { AiPlasmaOrb } from "./AiPlasmaOrb";

const EMPTY_CONVERSATION = { messages: [], summary: null, contextMessages: [] };
const NEAR_BOTTOM_PX = 80;
const COMPOSER_FALLBACK_HEIGHT = 150;
const HERO_SIZE = 84;
/** Scroll distance over which the chat's hero orb shrinks away and docks into the header. */
export const HERO_DOCK_DISTANCE = 110;

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function DayDivider({ label }: { label: string }) {
  const { c, f } = useAura();
  return (
    <View style={styles.divider}>
      <View style={[styles.dividerLine, { backgroundColor: c.hairline }]} />
      <Text style={[styles.dividerText, { color: c.textMuted, fontFamily: f.medium }]}>{label}</Text>
      <View style={[styles.dividerLine, { backgroundColor: c.hairline }]} />
    </View>
  );
}

/** Chat with the on-device model, scoped to the active trip (or a general thread). */
export function AiChat({
  activeModelName,
  scrollY,
  heroDocked,
}: {
  activeModelName: string | null;
  /** Written with the list's scroll offset so the header can dock the orb. */
  scrollY: SharedValue<number>;
  heroDocked: boolean;
}) {
  const { c, f, isDark } = useAura();
  const { t, formatDate } = useLocalization();
  const tabBarInset = useTabBarInset();
  const conversationKey = useChatConversationKey();
  const temporary = useChatStore((s) => s.temporary);
  const context = useChatContext();
  const contextIsTrip = useTripsStore((s) => s.trips.some((trip) => trip.id === context));
  const placeholder = t(
    context === GENERAL_CONTEXT
      ? "aiTab.placeholder.general"
      : context === OVERVIEW_CONTEXT
        ? "aiTab.placeholder.overview"
        : contextIsTrip
          ? "aiTab.placeholder.trip"
          : "aiTab.placeholder.group",
  );
  const conversation = useChatStore((state) => state.conversations[conversationKey] ?? EMPTY_CONVERSATION);
  const messages = conversation.messages;
  const generatingKey = useChatStore((state) => state.generatingConversationKey);
  const isGenerating = generatingKey === conversationKey;
  const sendMessage = useChatStore((s) => s.send);
  const stopReply = useChatStore((s) => s.stop);
  const streamingText = useChatStreamStore((s) => (s.conversationKey === conversationKey ? s.text : null));
  const provisioning = useAiProvisioning();
  const ai = useAiAvailability();
  const aiSources = useAiSources();
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const onlineName = ai.remote ? remoteLabel(ai.remote, ai.byok, t("aiTab.cloudName")) : null;
  const configuredName = ai.configured ? remoteLabel(ai.configured, ai.byok, t("aiTab.cloudName")) : null;
  const unavailableText = onlineName || provisioning.isReady ? null : provisionUnavailableText(provisioning, t);
  const onlineNoticeSeen = useSettingsStore((s) => s.onlineAiNoticeSeen);
  const setOnlineNoticeSeen = useSettingsStore((s) => s.setOnlineAiNoticeSeen);
  const [input, setInput] = useState("");
  const [notifyEnabled, setNotifyEnabled] = useState(() => modelNotifications.isEnabled());
  const [notifyDismissed, setNotifyDismissed] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_FALLBACK_HEIGHT);
  const [now] = useState(() => Date.now());
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const containerRef = useRef<View>(null);
  const blurTarget = useRef<View>(null);
  const nearBottom = useSharedValue(true);

  const animating = useAnimationsActive();
  const isEmpty = messages.length === 0;
  const busy = generatingKey !== null;
  const busyElsewhere = busy && !isGenerating;
  const composerBottom = tabBarInset > 0 ? tabBarInset + 2 : 8;

  const preloadLocal = ai.configured === null;
  useEffect(() => {
    if (preloadLocal) void aiRuntime.preload();
  }, [preloadLocal]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
    nearBottom.set(event.contentSize.height - (event.contentOffset.y + event.layoutMeasurement.height) < NEAR_BOTTOM_PX);
  });

  const onContentSizeChange = useCallback(() => {
    if (nearBottom.get()) scrollRef.current?.scrollToEnd({ animated: true });
  }, [nearBottom]);

  useEffect(() => {
    if (isEmpty) scrollY.set(0);
  }, [isEmpty, scrollY]);

  const heroStyle = useAnimatedStyle(() => {
    const progress = interpolate(scrollY.get(), [0, HERO_DOCK_DISTANCE], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: 1 - progress,
      transform: [{ translateY: progress * 24 }, { scale: 1 - progress * 0.45 }],
    };
  });

  // KeyboardAvoidingView measures itself relative to its parent, so the offset
  // must be the container's distance from the top of the window.
  const measureOffset = useCallback(() => {
    containerRef.current?.measureInWindow((_x, y) => {
      if (Number.isFinite(y)) setKeyboardOffset(Math.max(0, Math.round(y)));
    });
  }, []);

  const send = () => {
    const q = input.trim();
    if (!q) return;
    const accepted = sendMessage(conversationKey, q, {
      noModel: unavailableText ?? t("aiTab.provision.chatPreparing"),
      error: t("aiTab.chatModelLoadError"),
    });
    if (!accepted) return;
    track("ai_message_sent");
    setInput("");
    nearBottom.set(true);
  };

  const enableNotifications = async () => {
    const granted = await modelNotifications.setEnabled(true);
    setNotifyEnabled(granted);
    if (!granted) setNotifyDismissed(true);
  };

  const dayLabel = (timestamp: number) => {
    const key = localDayKey(timestamp);
    if (key === localDayKey(now)) return t("aiTab.today");
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === localDayKey(yesterday.getTime())) return t("aiTab.yesterday");
    return formatDate(timestamp);
  };

  const showOnlineNotice = configuredName !== null && !onlineNoticeSeen;
  const showNotifyBanner = !notifyEnabled && !notifyDismissed && !unavailableText && !showOnlineNotice;
  const lastIndex = messages.length - 1;

  return (
    <View ref={containerRef} style={styles.flex} onLayout={measureOffset}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={keyboardOffset}>
        <View style={styles.flex}>
          <BlurTargetView ref={blurTarget} style={styles.flex}>
            {unavailableText ? (
              <AuraCard tone={provisioning.phase === "waitingForWifi" ? auraStatusAccent.live : undefined} style={styles.banner}>
                <View accessibilityLiveRegion="polite" style={styles.bannerRow}>
                  <Icon
                    name={provisioning.phase === "waitingForWifi" ? "wifi" : "download"}
                    size={16}
                    color={provisioning.phase === "waitingForWifi" ? auraStatusAccent.live : c.textSoft}
                  />
                  <Text style={[styles.bannerText, { color: c.text, fontFamily: f.regular }]}>{unavailableText}</Text>
                </View>
              </AuraCard>
            ) : null}
            {showOnlineNotice ? (
              <AuraCard style={styles.banner}>
                <View style={styles.bannerRow}>
                  <Icon name="globe" size={16} color={c.textSoft} />
                  <Text style={[styles.bannerText, { color: c.text, fontFamily: f.regular }]}>
                    {t("aiTab.onlineNotice", { provider: configuredName })}
                  </Text>
                  <PressableScale
                    onPress={() => setOnlineNoticeSeen(true)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.close")}
                  >
                    <Icon name="x" size={15} color={c.textMuted} />
                  </PressableScale>
                </View>
              </AuraCard>
            ) : null}
            {showNotifyBanner ? (
              <AuraCard style={styles.banner}>
                <View style={styles.bannerRow}>
                  <Icon name="bell" size={16} color={c.textSoft} />
                  <Text numberOfLines={2} style={[styles.bannerText, { color: c.text, fontFamily: f.regular }]}>
                    {t("aiTab.notifyBannerText")}
                  </Text>
                  <PressableScale onPress={enableNotifications} hitSlop={8} accessibilityRole="button">
                    <Text style={[styles.bannerAction, { color: c.text, fontFamily: f.semibold }]}>{t("aiTab.notifyBannerAction")}</Text>
                  </PressableScale>
                  <PressableScale
                    onPress={() => setNotifyDismissed(true)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.close")}
                  >
                    <Icon name="x" size={15} color={c.textMuted} />
                  </PressableScale>
                </View>
              </AuraCard>
            ) : null}

            <Animated.ScrollView
              ref={scrollRef}
              contentContainerStyle={[
                styles.content,
                isEmpty && styles.contentEmpty,
                { paddingBottom: composerBottom + composerHeight + 20 },
              ]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              onScroll={onScroll}
              scrollEventThrottle={16}
              onContentSizeChange={onContentSizeChange}
            >
              {!isEmpty ? (
                <Animated.View style={[styles.hero, heroStyle]}>
                  <AiPlasmaOrb
                    size={HERO_SIZE}
                    mode={isGenerating ? "thinking" : "idle"}
                    isDark={isDark}
                    paused={!animating || heroDocked}
                    interactive
                  />
                </Animated.View>
              ) : null}
              {temporary && !isEmpty ? (
                <View style={[styles.tempTag, { borderColor: c.hairline }]}>
                  <Icon name="messageDashed" size={12} color={c.textMuted} strokeWidth={2} />
                  <Text style={[styles.tempTagText, { color: c.textMuted, fontFamily: f.medium }]}>{t("aiTab.temporary.tag")}</Text>
                </View>
              ) : null}
              {messages.map((m, i) => {
                const previous = messages[i - 1];
                const showDivider =
                  m.createdAt !== undefined &&
                  (previous?.createdAt === undefined || localDayKey(previous.createdAt) !== localDayKey(m.createdAt));
                return (
                  <React.Fragment key={`${m.createdAt ?? "x"}-${i}`}>
                    {showDivider && m.createdAt !== undefined ? <DayDivider label={dayLabel(m.createdAt)} /> : null}
                    <AiMessage
                      msg={m}
                      label={t("aiTab.assistantName")}
                      streamingText={isGenerating && i === lastIndex && streamingText ? streamingText : undefined}
                    />
                  </React.Fragment>
                );
              })}

              {isEmpty ? (
                temporary ? (
                  <Animated.View key="temp" entering={FadeIn.duration(260)} style={styles.empty}>
                    <View style={[styles.tempIcon, { borderColor: c.textMuted }]}>
                      <Icon name="messageDashed" size={30} color={c.textSoft} strokeWidth={1.8} />
                    </View>
                    <Text style={[styles.emptyTitle, { color: c.text, fontFamily: f.semibold }]}>{t("aiTab.temporary.title")}</Text>
                    <Text style={[styles.emptyHint, { color: c.textMuted, fontFamily: f.regular }]}>{t("aiTab.temporary.hint")}</Text>
                  </Animated.View>
                ) : (
                  <Animated.View key="intro" entering={FadeIn.duration(260)} style={styles.empty}>
                    <View style={styles.orb}>
                      <AiPlasmaOrb size={132} mode="idle" isDark={isDark} paused={!animating} interactive />
                    </View>
                    <Text style={[styles.emptyTitle, { color: c.text, fontFamily: f.semibold }]}>{t("aiTab.introTitle")}</Text>
                    <Text style={[styles.emptyHint, { color: c.textMuted, fontFamily: f.regular }]}>{onlineName ? t("aiTab.introHintOnline") : t("aiTab.introHint")}</Text>
                  </Animated.View>
                )
              ) : null}
            </Animated.ScrollView>
          </BlurTargetView>

          <AiComposer
            bottom={composerBottom}
            inputRef={inputRef}
            value={input}
            onChange={setInput}
            onSend={send}
            onStop={stopReply}
            generating={isGenerating}
            busy={busy}
            busyElsewhere={busyElsewhere}
            modelName={onlineName ?? activeModelName}
            placeholder={placeholder}
            online={onlineName !== null}
            onPickSource={aiSources.sources.length > 1 ? () => setSourcePickerOpen(true) : undefined}
            blurTarget={Platform.OS === "android" ? blurTarget : undefined}
            onLayout={(event) => setComposerHeight(Math.round(event.nativeEvent.layout.height))}
          />
        </View>
      </KeyboardAvoidingView>
      <AuraOptionSheet
        visible={sourcePickerOpen && aiSources.sources.length > 1}
        onClose={() => setSourcePickerOpen(false)}
        title={t("aiSource.pickerTitle")}
        subtitle={t("aiSource.pickerSubtitle")}
        options={aiSources.sources.map((source) => ({ value: source.id, label: source.label, detail: source.detail }))}
        selected={aiSources.current}
        onSelect={(id) => {
          if (id) aiSources.select(id);
        }}
        footnote={t("aiSource.pickerFootnote")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: { marginHorizontal: 20, marginBottom: 10, paddingVertical: 12 },
  bannerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bannerText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  bannerAction: { fontSize: 13.5 },
  content: { paddingHorizontal: 20, paddingTop: 6, gap: 18 },
  contentEmpty: { flexGrow: 1, justifyContent: "center" },
  divider: { flexDirection: "row", alignItems: "center", gap: 10 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 12 },
  empty: { alignItems: "center" },
  emptyTitle: { fontSize: 22, letterSpacing: -0.6, textAlign: "center", marginTop: 6 },
  orb: { marginBottom: 18 },
  hero: { alignSelf: "center", marginTop: 18, marginBottom: 14 },
  tempIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  tempTag: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  tempTagText: { fontSize: 12 },
  emptyHint: { fontSize: 14.5, lineHeight: 21, textAlign: "center", marginTop: 8, maxWidth: 280 },
});
