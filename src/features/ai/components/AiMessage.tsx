import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { AuraOrb, useAura } from "@/atoms";
import type { ChatMessage } from "../store/chatStore";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

/** Renders **bold** and `code` spans within a single line. */
function renderInline(line: string, colors: { text: string; code: string }, bold: string, keyPrefix: string) {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
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
    return <Text key={key}>{part}</Text>;
  });
}

/** Minimal markdown: headings, bullet / numbered lists, bold, inline code. */
function MarkdownText({ text }: { text: string }) {
  const { c, f } = useAura();
  const colors = { text: c.text, code: c.surfaceStrong };
  const body = [styles.body, { color: c.text, fontFamily: f.regular }];
  return (
    <View style={styles.markdown}>
      {text.split("\n").map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={styles.gap} />;

        const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
        if (heading) {
          return (
            <Text key={i} style={[body, styles.heading, { fontFamily: f.semibold }]}>
              {renderInline(heading[1], colors, f.bold, `h${i}`)}
            </Text>
          );
        }

        const bullet = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <View key={i} style={styles.listRow}>
              <Text style={[body, styles.listMarker, { color: c.textMuted }]}>{bullet[1] ? `${bullet[1]}.` : "•"}</Text>
              <Text style={[body, styles.flex]}>{renderInline(bullet[2], colors, f.semibold, `l${i}`)}</Text>
            </View>
          );
        }

        return (
          <Text key={i} style={body}>
            {renderInline(line, colors, f.semibold, `p${i}`)}
          </Text>
        );
      })}
    </View>
  );
}

function Skeleton() {
  const { c } = useAura();
  return (
    <View style={styles.skeleton}>
      {[88, 70, 52].map((w) => (
        <View key={w} style={[styles.bar, { width: `${w}%`, backgroundColor: c.surfaceStrong }]} />
      ))}
    </View>
  );
}

/** One chat turn: user text in an inverse bubble, assistant markdown flush left under a name row. */
export function AiMessage({ msg, label, streamingText }: { msg: ChatMessage; label: string; streamingText?: string }) {
  const { c, f, isDark, accent } = useAura();
  const text = streamingText ?? msg.text;

  if (msg.from === "you") {
    return (
      <View style={[styles.userBubble, { backgroundColor: c.inverse }]}>
        <Text style={[styles.body, { color: c.onInverse, fontFamily: f.regular }]}>{text}</Text>
      </View>
    );
  }

  return (
    <View style={styles.assistant}>
      <View style={styles.nameRow}>
        {msg.generating ? (
          <AuraOrb size={22} mode="thinking" isDark={isDark} core={false} />
        ) : (
          <View style={styles.dotWrap}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
          </View>
        )}
        <Text style={[styles.name, { color: c.textMuted, fontFamily: f.medium }]}>{label}</Text>
      </View>
      {msg.generating && !text ? <Skeleton /> : <MarkdownText text={text} />}
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
  skeleton: { gap: 8, paddingTop: 4 },
  bar: { height: 10, borderRadius: 5 },
});
