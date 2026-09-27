import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NOMAD_FONTS, type NomadColors } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
import { Icon } from "@/components/nomad/Icon";
import { GENERAL_CHAT_KEY, useChatStore, useChatStreamStore, type ChatMessage } from "../store/chatStore";
import { localModelService } from "../services/localModelService";
import { modelNotifications } from "../services/modelNotifications";
import type { MoneyIntent } from "../services/moneyFacts";
import { useTripsStore } from "@/features/trips/store/tripsStore";

interface Props {
  theme: NomadColors;
  activeModelName?: string | null;
}

const EMPTY_CONVERSATION = { messages: [], summary: null, contextMessages: [] };
const NEAR_BOTTOM_PX = 80;

/** Renders **bold** and `code` spans within a single line. */
function renderInline(line: string, theme: NomadColors, keyPrefix: string) {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={key} style={{ fontFamily: NOMAD_FONTS.uiBold, color: theme.inkDeep }}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text key={key} style={[styles.inlineCode, { backgroundColor: theme.hairline, color: theme.inkDeep }]}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    return <Text key={key}>{part}</Text>;
  });
}

/** Minimal markdown: headings, bullet / numbered lists, bold, inline code. */
function MarkdownText({ text, color, theme }: { text: string; color: string; theme: NomadColors }) {
  const lines = text.split("\n");
  return (
    <View style={{ gap: 4 }}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={{ height: 4 }} />;

        const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
        if (heading) {
          return (
            <Text key={i} style={[styles.bubbleText, styles.heading, { color }]}>
              {renderInline(heading[1], theme, `h${i}`)}
            </Text>
          );
        }

        const bullet = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <View key={i} style={styles.listRow}>
              <Text style={[styles.bubbleText, styles.listMarker, { color }]}>
                {bullet[1] ? `${bullet[1]}.` : "•"}
              </Text>
              <Text style={[styles.bubbleText, { color, flex: 1 }]}>
                {renderInline(bullet[2], theme, `l${i}`)}
              </Text>
            </View>
          );
        }

        return (
          <Text key={i} style={[styles.bubbleText, { color }]}>
            {renderInline(line, theme, `p${i}`)}
          </Text>
        );
      })}
    </View>
  );
}

function ChatBubble({
  msg,
  theme,
  label,
  streamingText,
}: {
  msg: ChatMessage;
  theme: NomadColors;
  label: string;
  streamingText?: string;
}) {
  const you = msg.from === "you";
  const text = streamingText ?? msg.text;
  const showPlaceholder = msg.generating && !text;
  const textColor = you ? theme.paperSoft : theme.inkDeep;
  return (
    <View style={{ alignSelf: you ? "flex-end" : "flex-start", maxWidth: "86%" }}>
      {!you && (
        <View style={styles.aiLabel}>
          <View style={[styles.aiOrb, { backgroundColor: theme.teal }]} />
          <Text style={[styles.aiLabelText, { color: theme.inkMuted }]}>{label}</Text>
        </View>
      )}
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: you ? theme.inkDeep : theme.paperSoft,
            borderTopRightRadius: you ? 6 : 18,
            borderTopLeftRadius: you ? 18 : 6,
            borderWidth: you ? 0 : 1,
            borderColor: theme.hairline,
          },
        ]}
      >
        {showPlaceholder ? (
          <GeneratingBars theme={theme} />
        ) : you ? (
          <Text style={[styles.bubbleText, { color: textColor }]}>{text}</Text>
        ) : (
          <MarkdownText text={text} color={textColor} theme={theme} />
        )}
      </View>
    </View>
  );
}

function GeneratingBars({ theme }: { theme: NomadColors }) {
  return (
    <View style={{ gap: 6, width: "100%" }}>
      {[85, 65, 75].map((w, i) => (
        <View
          key={i}
          style={{
            width: `${w}%`,
            height: 9,
            borderRadius: 5,
            backgroundColor: theme.hairline,
          }}
        />
      ))}
    </View>
  );
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function DayDivider({ label, theme }: { label: string; theme: NomadColors }) {
  return (
    <View style={styles.divider}>
      <View style={[styles.dividerLine, { backgroundColor: theme.hairline }]} />
      <Text style={[styles.dividerText, { color: theme.inkMuted }]}>{label}</Text>
      <View style={[styles.dividerLine, { backgroundColor: theme.hairline }]} />
    </View>
  );
}

export function AiChat({ theme, activeModelName }: Props) {
  const { t, formatDate } = useLocalization();
  const insets = useSafeAreaInsets();
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const conversationKey = activeTripId ?? GENERAL_CHAT_KEY;
  const conversation = useChatStore((state) => state.conversations[conversationKey] ?? EMPTY_CONVERSATION);
  const messages = conversation.messages;
  const generatingKey = useChatStore((state) => state.generatingConversationKey);
  const isGenerating = generatingKey === conversationKey;
  const sendMessage = useChatStore((s) => s.send);
  const stopReply = useChatStore((s) => s.stop);
  const streamingText = useChatStreamStore((s) =>
    s.conversationKey === conversationKey ? s.text : null,
  );
  const [input, setInput] = useState("");
  const [notifyEnabled, setNotifyEnabled] = useState(() => modelNotifications.isEnabled());
  const [notifyDismissed, setNotifyDismissed] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [now] = useState(() => Date.now());
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const containerRef = useRef<View>(null);
  const nearBottomRef = useRef(true);

  const isEmpty = messages.length === 0;

  useEffect(() => {
    localModelService.preload();
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    nearBottomRef.current =
      contentSize.height - (contentOffset.y + layoutMeasurement.height) < NEAR_BOTTOM_PX;
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

  const prompts = [
    { icon: "trendDown" as const, label: t("aiTab.promptOverspend"), color: theme.stamp },
    { icon: "trendUp" as const, label: t("aiTab.promptForecast"), color: theme.teal },
    { icon: "wallet" as const, label: t("aiTab.promptCategory"), color: theme.mustard },
    { icon: "sparkle" as const, label: t("aiTab.promptSave"), color: theme.sky },
  ];

  const quickQuestions: { label: string; question: string; intent: MoneyIntent }[] = [
    { label: t("aiTab.quickDaily"), question: t("aiTab.quickDailyQuestion"), intent: "dailyBudget" },
    { label: t("aiTab.quickLeft"), question: t("aiTab.quickLeftQuestion"), intent: "remaining" },
    { label: t("aiTab.quickTop"), question: t("aiTab.quickTopQuestion"), intent: "topCategory" },
  ];

  const send = (text?: string, intent?: MoneyIntent) => {
    const q = (text ?? input).trim();
    if (!q) return;
    const accepted = sendMessage(
      conversationKey,
      q,
      { noModel: t("aiTab.chatNoModel"), error: t("aiTab.chatModelLoadError") },
      { intent },
    );
    if (!accepted) return;
    if (text === undefined) setInput("");
    nearBottomRef.current = true;
  };

  const startAffordQuestion = () => {
    setInput(`${t("aiTab.quickAffordPrefix")} `);
    inputRef.current?.focus();
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

  const showNotifyBanner = !notifyEnabled && !notifyDismissed;
  const busyElsewhere = generatingKey !== null && !isGenerating;
  const canSend = input.trim().length > 0 && generatingKey === null;
  const lastIndex = messages.length - 1;

  return (
    <View ref={containerRef} style={{ flex: 1 }} onLayout={measureOffset}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={keyboardOffset}>
        <View style={{ flex: 1 }}>
          {showNotifyBanner && (
            <View style={[styles.notifyBanner, { backgroundColor: theme.tealSoft, borderColor: theme.teal }]}>
              <Icon name="bell" size={15} color={theme.teal} strokeWidth={2} />
              <Text style={[styles.notifyText, { color: theme.inkDeep }]} numberOfLines={2}>
                {t("aiTab.notifyBannerText")}
              </Text>
              <Pressable onPress={enableNotifications} hitSlop={8}>
                <Text style={[styles.notifyAction, { color: theme.teal }]}>{t("aiTab.notifyBannerAction")}</Text>
              </Pressable>
              <Pressable onPress={() => setNotifyDismissed(true)} hitSlop={8}>
                <Icon name="x" size={15} color={theme.inkMuted} strokeWidth={2} />
              </Pressable>
            </View>
          )}
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[styles.content, { gap: 14 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={100}
            onContentSizeChange={onContentSizeChange}
          >
            {messages.map((m, i) => {
              const previous = messages[i - 1];
              const showDivider =
                m.createdAt !== undefined &&
                (previous?.createdAt === undefined ||
                  localDayKey(previous.createdAt) !== localDayKey(m.createdAt));
              return (
                <React.Fragment key={i}>
                  {showDivider && m.createdAt !== undefined ? (
                    <DayDivider label={dayLabel(m.createdAt)} theme={theme} />
                  ) : null}
                  <ChatBubble
                    msg={m}
                    theme={theme}
                    label={t("aiTab.assistantName")}
                    streamingText={
                      isGenerating && i === lastIndex && streamingText ? streamingText : undefined
                    }
                  />
                </React.Fragment>
              );
            })}

            {isEmpty && (
              <View style={{ paddingTop: 8 }}>
                <Text style={[styles.tryAsking, { color: theme.inkMuted }]}>{t("aiTab.tryAsking")}</Text>
                <View style={styles.promptGrid}>
                  {prompts.map((p, i) => (
                    <Pressable
                      key={i}
                      onPress={() => send(p.label)}
                      disabled={generatingKey !== null}
                      style={({ pressed }) => [
                        styles.prompt,
                        {
                          backgroundColor: theme.paperSoft,
                          borderColor: theme.hairline,
                          opacity: generatingKey !== null ? 0.5 : pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.promptIcon, { backgroundColor: `${p.color}22` }]}>
                        <Icon name={p.icon} size={15} color={p.color} strokeWidth={2} />
                      </View>
                      <Text style={[styles.promptLabel, { color: theme.inkDeep }]}>{p.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>

          <View
            style={[
              styles.composer,
              {
                backgroundColor: theme.paper,
                borderTopColor: theme.hairline,
                // Android native tabs lay out content above the tab bar; iOS
                // content extends under the translucent bar.
                paddingBottom: (Platform.OS === "ios" ? insets.bottom : 0) + 10,
              },
            ]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              accessibilityLabel={t("aiTab.quickQuestions")}
              style={styles.chipScroll}
              contentContainerStyle={styles.chipRow}
            >
              {quickQuestions.map((chip) => (
                <Pressable
                  key={chip.intent}
                  onPress={() => send(chip.question, chip.intent)}
                  disabled={generatingKey !== null}
                  accessibilityRole="button"
                  accessibilityHint={chip.question}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: theme.paperSoft,
                      borderColor: theme.hairline,
                      opacity: generatingKey !== null ? 0.5 : pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: theme.inkDeep }]}>{chip.label}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={startAffordQuestion}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.chip,
                  { backgroundColor: theme.paperSoft, borderColor: theme.hairline, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={[styles.chipText, { color: theme.inkDeep }]}>{t("aiTab.quickAfford")}</Text>
              </Pressable>
            </ScrollView>
            {busyElsewhere ? (
              <Text style={[styles.busyText, { color: theme.inkMuted }]}>{t("aiTab.chatBusyElsewhere")}</Text>
            ) : activeModelName ? (
              <View style={styles.modelPill}>
                <View style={[styles.modelOrb, { backgroundColor: theme.teal }]} />
                <Text style={[styles.modelPillText, { color: theme.inkSoft }]}>
                  {t("aiTab.chatModel", { model: activeModelName })}
                </Text>
              </View>
            ) : null}
            <View
              style={[
                styles.inputRow,
                { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
              ]}
            >
              <View style={[styles.inputOrb, { backgroundColor: theme.teal }]} />
              <TextInput
                ref={inputRef}
                value={input}
                onChangeText={setInput}
                placeholder={t("aiTab.chatPlaceholder")}
                placeholderTextColor={theme.inkMuted}
                multiline
                maxLength={300}
                style={[styles.input, { color: theme.inkDeep }]}
              />
              {isGenerating ? (
                <Pressable
                  onPress={stopReply}
                  accessibilityRole="button"
                  accessibilityLabel={t("aiTab.stopReply")}
                  style={({ pressed }) => [
                    styles.sendBtn,
                    { backgroundColor: theme.stamp, opacity: pressed ? 0.9 : 1 },
                  ]}
                >
                  <View style={[styles.stopSquare, { backgroundColor: theme.paperSoft }]} />
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => send()}
                  disabled={!canSend}
                  accessibilityRole="button"
                  accessibilityLabel={t("aiTab.sendMessage")}
                  style={({ pressed }) => [
                    styles.sendBtn,
                    {
                      backgroundColor: canSend ? theme.inkDeep : theme.hairline,
                      opacity: pressed && canSend ? 0.9 : 1,
                    },
                  ]}
                >
                  <Icon
                    name="send"
                    size={16}
                    color={canSend ? theme.paperSoft : theme.inkMuted}
                    strokeWidth={2}
                  />
                </Pressable>
              )}
            </View>
            <View style={styles.privacyRow}>
              <Icon name="lock" size={11} color={theme.inkMuted} strokeWidth={2} />
              <Text style={[styles.privacyText, { color: theme.inkMuted }]}>{t("aiTab.chatPrivacy")}</Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  notifyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  notifyText: { flex: 1, fontFamily: NOMAD_FONTS.uiSemi, fontSize: 12, lineHeight: 16 },
  notifyAction: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  divider: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9.5,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  aiLabel: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, paddingLeft: 2 },
  aiOrb: { width: 10, height: 10, borderRadius: 999 },
  aiLabelText: { fontFamily: NOMAD_FONTS.uiBold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase" },
  bubble: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  bubbleText: { fontFamily: NOMAD_FONTS.ui, fontSize: 14, lineHeight: 20 },
  heading: { fontFamily: NOMAD_FONTS.uiBold, fontSize: 15 },
  listRow: { flexDirection: "row", gap: 6 },
  listMarker: { minWidth: 14 },
  inlineCode: { fontFamily: NOMAD_FONTS.mono, fontSize: 13 },
  busyText: { fontFamily: NOMAD_FONTS.mono, fontSize: 10, marginBottom: 8, textAlign: "center" },
  stopSquare: { width: 12, height: 12, borderRadius: 2 },
  tryAsking: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
    paddingLeft: 2,
  },
  promptGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  prompt: {
    width: "48%",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    gap: 8,
  },
  promptIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  promptLabel: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 12, lineHeight: 16 },
  composer: {
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  chipScroll: { flexGrow: 0, marginHorizontal: -14, marginBottom: 8 },
  chipRow: { gap: 6, paddingHorizontal: 14 },
  chip: { borderRadius: 999, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 12 },
  modelPill: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, alignSelf: "center" },
  modelOrb: { width: 8, height: 8, borderRadius: 999 },
  modelPillText: { fontFamily: NOMAD_FONTS.mono, fontSize: 10, letterSpacing: 0.3 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderRadius: 22,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 6,
    paddingLeft: 12,
  },
  inputOrb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 14,
    lineHeight: 20,
    maxHeight: 80,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  privacyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8 },
  privacyText: { fontFamily: NOMAD_FONTS.mono, fontSize: 10, letterSpacing: 0.5 },
});
