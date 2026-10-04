import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { BlurTargetView } from "expo-blur";
import Animated, { FadeIn } from "react-native-reanimated";
import { AuraCard, AuraOptionSheet, AuraOrb, Icon, PressableScale, useAura, useTabBarInset } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import { useLocalization } from "@/localization";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { track } from "@/modules/analytics";
import { GENERAL_CHAT_KEY, useChatStore, useChatStreamStore } from "../store/chatStore";
import { aiRuntime, modelNotifications, remoteLabel, useAiAvailability, useAiProvisioning, useAiSources } from "@/modules/ai";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { provisionUnavailableText } from "../utils/provisionCopy";
import { AiComposer } from "./AiComposer";
import { AiMessage } from "./AiMessage";

const EMPTY_CONVERSATION = { messages: [], summary: null, contextMessages: [] };
const NEAR_BOTTOM_PX = 80;
const COMPOSER_FALLBACK_HEIGHT = 150;

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
export function AiChat({ activeModelName }: { activeModelName: string | null }) {
  const { c, f, isDark } = useAura();
  const { t, formatDate } = useLocalization();
  const tabBarInset = useTabBarInset();
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const conversationKey = activeTripId ?? GENERAL_CHAT_KEY;
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
  const nearBottomRef = useRef(true);

  const animating = useAnimationsActive();
  const isEmpty = messages.length === 0;
  const busy = generatingKey !== null;
  const busyElsewhere = busy && !isGenerating;
  const composerBottom = tabBarInset > 0 ? tabBarInset + 2 : 8;

  const preloadLocal = ai.configured === null;
  useEffect(() => {
    if (preloadLocal) void aiRuntime.preload();
  }, [preloadLocal]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    nearBottomRef.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < NEAR_BOTTOM_PX;
  }, []);

  const onContentSizeChange = useCallback(() => {
    if (nearBottomRef.current) scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

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
    nearBottomRef.current = true;
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

            <ScrollView
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
              scrollEventThrottle={100}
              onContentSizeChange={onContentSizeChange}
            >
              {messages.map((m, i) => {
                const previous = messages[i - 1];
                const showDivider =
                  m.createdAt !== undefined &&
                  (previous?.createdAt === undefined || localDayKey(previous.createdAt) !== localDayKey(m.createdAt));
                return (
                  <React.Fragment key={i}>
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
                <Animated.View entering={FadeIn.duration(260)} style={styles.empty}>
                  <AuraOrb size={124} mode="idle" isDark={isDark} paused={!animating} />
                  <Text style={[styles.emptyTitle, { color: c.text, fontFamily: f.semibold }]}>{t("aiTab.introTitle")}</Text>
                  <Text style={[styles.emptyHint, { color: c.textMuted, fontFamily: f.regular }]}>{onlineName ? t("aiTab.introHintOnline") : t("aiTab.introHint")}</Text>
                </Animated.View>
              ) : null}
            </ScrollView>
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
  emptyHint: { fontSize: 14.5, lineHeight: 21, textAlign: "center", marginTop: 8, maxWidth: 280 },
});
