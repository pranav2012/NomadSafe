import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useAura } from "@/atoms";
import { auraStatusColors } from "@/constants/aura";
import type { ChatMessage } from "../store/chatStore";
import { AiPlasmaOrb } from "./AiPlasmaOrb";
import { AiThinking } from "./AiThinking";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const REVEAL_FRAME_MS = 32;
const REVEAL_FRAMES = 6;
const TAIL_CHARS = 10;
const CURSOR_MS = 420;

function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

/**
 * Types `text` out at a pace that catches up within a few frames, so bursty streams read smoothly.
 * Messages that weren't live when mounted (history) show in full straight away.
 */
function useRevealedText(text: string, live: boolean): string {
  const [shown, setShown] = useState(() => (live ? 0 : text.length));
  const target = text.length;
  useEffect(() => {
    if (shown >= target) return;
    const id = setTimeout(() => {
      setShown((value) => Math.min(target, value + Math.max(2, Math.ceil((target - value) / REVEAL_FRAMES))));
    }, REVEAL_FRAME_MS);
    return () => clearTimeout(id);
  }, [shown, target]);
  return shown >= target ? text : text.slice(0, shown);
}

/** Dot at the end of a streaming reply that steps through the aura palette. */
function StreamCursor() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((value) => (value + 1) % auraStatusColors.calm.length), CURSOR_MS);
    return () => clearInterval(id);
  }, []);
  return <Text style={[styles.cursor, { color: auraStatusColors.calm[step] }]}>{" ●"}</Text>;
}

/** Splits the last characters of a plain span into fading letters, so new text appears to materialise. */
function fadeTail(part: string, color: string, keyPrefix: string) {
  const chars = Array.from(part);
  const head = chars.slice(0, -TAIL_CHARS).join("");
  const tail = chars.slice(-TAIL_CHARS);
  return (
    <React.Fragment key={keyPrefix}>
      {head}
      {tail.map((char, i) => (
        <Text key={i} style={{ color: withAlpha(color, 1 - (i + 1) / (tail.length + 1)) }}>
          {char}
        </Text>
      ))}
    </React.Fragment>
  );
}

/** Renders **bold** and `code` spans within a single line; `tail` fades the end of the line while streaming. */
function renderInline(line: string, colors: { text: string; code: string }, bold: string, keyPrefix: string, tail = false) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={key} style={{ fontFamily: bold, color: colors.text }}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text key={key} style={[styles.inlineCode, { backgroundColor: colors.code, color: colors.text }]}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    if (tail && i === parts.length - 1) return fadeTail(part, colors.text, key);
    return <Text key={key}>{part}</Text>;
  });
}

/** Minimal markdown: headings, bullet / numbered lists, bold, inline code. `streaming` adds the fading tail and cursor. */
function MarkdownText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { c, f } = useAura();
  const colors = { text: c.text, code: c.surfaceStrong };
  const body = [styles.body, { color: c.text, fontFamily: f.regular }];
  const lines = text.split("\n");
  const lastLine = streaming ? lines.findLastIndex((line) => line.trim().length > 0) : -1;
  return (
    <View style={styles.markdown}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        const live = i === lastLine;
        const cursor = live ? <StreamCursor /> : null;
        if (!line.trim()) return <View key={i} style={styles.gap} />;

        const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
        if (heading) {
          return (
            <Text key={i} style={[body, styles.heading, { fontFamily: f.semibold }]}>
              {renderInline(heading[1], colors, f.bold, `h${i}`, live)}
              {cursor}
            </Text>
          );
        }

        const bullet = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <View key={i} style={styles.listRow}>
              <Text style={[body, styles.listMarker, { color: c.textMuted }]}>{bullet[1] ? `${bullet[1]}.` : "•"}</Text>
              <Text style={[body, styles.flex]}>
                {renderInline(bullet[2], colors, f.semibold, `l${i}`, live)}
                {cursor}
              </Text>
            </View>
          );
        }

        return (
          <Text key={i} style={body}>
            {renderInline(line, colors, f.semibold, `p${i}`, live)}
            {cursor}
          </Text>
        );
      })}
    </View>
  );
}

/** One chat turn: user text in an inverse bubble, assistant markdown flush left under a name row. */
export function AiMessage({ msg, label, streamingText }: { msg: ChatMessage; label: string; streamingText?: string }) {
  const { c, f, isDark, accent } = useAura();
  const fullText = streamingText ?? msg.text;
  const isAssistant = msg.from === "ai";
  const text = useRevealedText(fullText, isAssistant && msg.generating === true);
  const streaming = msg.generating === true || text.length < fullText.length;

  if (!isAssistant) {
    return (
      <View style={[styles.userBubble, { backgroundColor: c.inverse }]}>
        <Text style={[styles.body, { color: c.onInverse, fontFamily: f.regular }]}>{text}</Text>
      </View>
    );
  }

  return (
    <View style={styles.assistant}>
      <View style={styles.nameRow}>
        {streaming ? (
          <View style={styles.dotWrap}>
            <AiPlasmaOrb size={16} mode="thinking" isDark={isDark} contained />
          </View>
        ) : (
          <View style={styles.dotWrap}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
          </View>
        )}
        <Text style={[styles.name, { color: c.textMuted, fontFamily: f.medium }]}>{label}</Text>
      </View>
      {streaming && !text ? <AiThinking /> : <MarkdownText text={text} streaming={streaming} />}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  markdown: { gap: 4 },
  gap: { height: 4 },
  body: { fontSize: 15.5, lineHeight: 23 },
  heading: { fontSize: 16.5 },
  listRow: { flexDirection: "row", gap: 8 },
  listMarker: { minWidth: 14 },
  inlineCode: { fontFamily: MONO, fontSize: 13.5 },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "82%",
    paddingVertical: 11,
    paddingHorizontal: 15,
    borderRadius: 22,
    borderBottomRightRadius: 6,
  },
  assistant: { alignSelf: "stretch", paddingRight: 12 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, marginLeft: -4 },
  dotWrap: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontSize: 13 },
  cursor: { fontSize: 12 },
});
