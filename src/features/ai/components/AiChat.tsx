import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NOMAD_FONTS, type NomadColors } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
import { Icon } from "@/components/nomad/Icon";
import { NomadCard } from "@/components/nomad/Card";
import { useChatStore } from "../store/chatStore";
import { localModelService } from "../services/localModelService";
import { modelNotifications } from "../services/modelNotifications";

interface Props {
  theme: NomadColors;
  activeModelName?: string | null;
}

type Message = {
  from: "ai" | "you";
  text: string;
  attach?: { kind: "stat"; stat: string; label: string } | { kind: "chart"; bars: number[]; highlight: number };
  generating?: boolean;
};

function formatText(text: string, theme: NomadColors) {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part, i) => {
    if (part.startsWith("**")) {
      return (
        <Text key={i} style={{ fontWeight: "700", color: theme.inkDeep }}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return (
      <Text key={i}>
        {part.split("\n").map((line, j) => (
          <React.Fragment key={j}>
            {j > 0 ? <Text>{"\n"}</Text> : null}
            {line}
          </React.Fragment>
        ))}
      </Text>
    );
  });
}

function ChatBubble({ msg, theme }: { msg: Message; theme: NomadColors }) {
  const you = msg.from === "you";
  return (
    <View style={{ alignSelf: you ? "flex-end" : "flex-start", maxWidth: "86%" }}>
      {!you && (
        <View style={styles.aiLabel}>
          <View style={[styles.aiOrb, { backgroundColor: theme.teal }]} />
          <Text style={[styles.aiLabelText, { color: theme.inkMuted }]}>Nomad</Text>
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
        {msg.generating ? (
          <GeneratingBars theme={theme} />
        ) : (
          <Text style={[styles.bubbleText, { color: you ? theme.paperSoft : theme.inkDeep }]}>
            {formatText(msg.text, theme)}
          </Text>
        )}
      </View>
      {msg.attach && !msg.generating && <AIAttachment attach={msg.attach} theme={theme} />}
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

function AIAttachment({
  attach,
  theme,
}: {
  attach: NonNullable<Message["attach"]>;
  theme: NomadColors;
}) {
  if (attach.kind === "stat") {
    return (
      <NomadCard
        theme={theme}
        style={{
          backgroundColor: theme.teal,
          borderColor: theme.teal,
          marginTop: 8,
        }}
        padding={14}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={[styles.statBig, { color: theme.inverse }]}>{attach.stat}</Text>
          <View style={{ width: 1, height: 26, backgroundColor: "rgba(255,255,255,0.3)" }} />
          <Text style={[styles.statLabel, { color: theme.inverse }]}>{attach.label}</Text>
        </View>
      </NomadCard>
    );
  }

  const max = Math.max(...attach.bars);
  return (
    <NomadCard theme={theme} style={{ marginTop: 8 }} padding={12}>
      <Text style={[styles.sectionLabel, { color: theme.inkMuted, marginBottom: 8 }]}>
        Daily spend · last 7
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: 70 }}>
        {attach.bars.map((v, i) => {
          const hl = i === attach.highlight;
          return (
            <View key={i} style={{ flex: 1, alignItems: "center", gap: 3 }}>
              <View
                style={{
                  width: "100%",
                  height: max > 0 ? (v / max) * 50 : 0,
                  backgroundColor: hl ? theme.stamp : theme.teal,
                  opacity: hl ? 1 : 0.65,
                  borderRadius: 3,
                }}
              />
              <Text style={{ fontFamily: NOMAD_FONTS.monoMedium, fontSize: 9, color: hl ? theme.stamp : theme.inkMuted }}>
                ${v}
              </Text>
            </View>
          );
        })}
      </View>
    </NomadCard>
  );
}

export function AiChat({ theme, activeModelName }: Props) {
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const messages = useChatStore((s) => s.messages);
  const isGenerating = useChatStore((s) => s.isGenerating);
  const sendMessage = useChatStore((s) => s.send);
  const [input, setInput] = useState("");
  const [notifyEnabled, setNotifyEnabled] = useState(() => modelNotifications.isEnabled());
  const [notifyDismissed, setNotifyDismissed] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const isEmpty = messages.length === 0;

  const welcome: Message = {
    from: "ai",
    text: t("aiTab.chatWelcome"),
    attach: { kind: "stat", stat: "$312", label: t("aiTab.projectedSurplus") },
  };

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  useEffect(() => {
    localModelService.preload();
  }, []);

  const prompts = [
    { icon: "trendDown" as const, label: t("aiTab.promptOverspend"), color: theme.stamp },
    { icon: "trendUp" as const, label: t("aiTab.promptForecast"), color: theme.teal },
    { icon: "wallet" as const, label: t("aiTab.promptCategory"), color: theme.mustard },
    { icon: "sparkle" as const, label: t("aiTab.promptSave"), color: theme.sky },
  ];

  const send = (text?: string) => {
    const q = (text ?? input).trim();
    if (!q) return;
    setInput("");
    sendMessage(q, { noModel: t("aiTab.chatNoModel"), error: t("aiTab.chatError") });
  };

  const enableNotifications = async () => {
    const granted = await modelNotifications.setEnabled(true);
    setNotifyEnabled(granted);
    if (!granted) setNotifyDismissed(true);
  };

  const showNotifyBanner = !notifyEnabled && !notifyDismissed;
  const canSend = input.trim().length > 0 && !isGenerating;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
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
        >
          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: theme.hairline }]} />
            <Text style={[styles.dividerText, { color: theme.inkMuted }]}>{t("aiTab.today")}</Text>
            <View style={[styles.dividerLine, { backgroundColor: theme.hairline }]} />
          </View>

          {isEmpty && <ChatBubble msg={welcome} theme={theme} />}

          {messages.map((m, i) => (
            <ChatBubble key={i} msg={m} theme={theme} />
          ))}

          {isEmpty && (
            <View style={{ paddingTop: 8 }}>
              <Text style={[styles.tryAsking, { color: theme.inkMuted }]}>{t("aiTab.tryAsking")}</Text>
              <View style={styles.promptGrid}>
                {prompts.map((p, i) => (
                  <Pressable
                    key={i}
                    onPress={() => send(p.label)}
                    style={({ pressed }) => [
                      styles.prompt,
                      {
                        backgroundColor: theme.paperSoft,
                        borderColor: theme.hairline,
                        opacity: pressed ? 0.8 : 1,
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
              paddingBottom: insets.bottom + 10,
            },
          ]}
        >
          {activeModelName && (
            <View style={styles.modelPill}>
              <View style={[styles.modelOrb, { backgroundColor: theme.teal }]} />
              <Text style={[styles.modelPillText, { color: theme.inkSoft }]}>
                {t("aiTab.chatModel", { model: activeModelName })}
              </Text>
            </View>
          )}
          <View
            style={[
              styles.inputRow,
              { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
            ]}
          >
            <View style={[styles.inputOrb, { backgroundColor: theme.teal }]} />
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t("aiTab.chatPlaceholder")}
              placeholderTextColor={theme.inkMuted}
              multiline
              maxLength={300}
              style={[styles.input, { color: theme.inkDeep }]}
            />
            <Pressable
              onPress={() => send()}
              disabled={!canSend}
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
          </View>
          <View style={styles.privacyRow}>
            <Icon name="lock" size={11} color={theme.inkMuted} strokeWidth={2} />
            <Text style={[styles.privacyText, { color: theme.inkMuted }]}>{t("aiTab.chatPrivacy")}</Text>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
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
  statBig: { fontFamily: NOMAD_FONTS.display, fontSize: 34, lineHeight: 36, letterSpacing: -0.5 },
  statLabel: { fontFamily: NOMAD_FONTS.ui, fontSize: 11, lineHeight: 15, flex: 1, opacity: 0.92 },
  sectionLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
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
