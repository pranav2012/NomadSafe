import React, { type RefObject } from "react";
import { StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useAura } from "@/components/aura/useAura";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { GlassSurface } from "@/components/tabbar/GlassSurface";
import { useLocalization } from "@/localization";

export const MAX_INPUT = 300;
const RADIUS = 26;
const COUNTER_FROM = 240;

interface Props {
  bottom: number;
  inputRef: RefObject<TextInput | null>;
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  generating: boolean;
  busy: boolean;
  busyElsewhere: boolean;
  modelName: string | null;
  blurTarget?: RefObject<View | null>;
  onLayout?: (event: LayoutChangeEvent) => void;
}

function ArrowUp({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M12 19V5M5 12l7-7 7 7" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Floating glass composer above the tab bar: input, send / stop and a status line. */
export function AiComposer({
  bottom,
  inputRef,
  value,
  onChange,
  onSend,
  onStop,
  generating,
  busy,
  busyElsewhere,
  modelName,
  blurTarget,
  onLayout,
}: Props) {
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const canSend = value.trim().length > 0 && !busy;

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none" onLayout={onLayout}>
      <View style={[styles.panel, { borderColor: c.hairline }]}>
        <GlassSurface isDark={isDark} radius={RADIUS} blurTarget={blurTarget} />
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChange}
            placeholder={t("aiTab.chatPlaceholder")}
            placeholderTextColor={c.textMuted}
            multiline
            maxLength={MAX_INPUT}
            style={[styles.input, { color: c.text, fontFamily: f.regular }]}
          />
          {generating ? (
            <PressableScale
              onPress={onStop}
              accessibilityRole="button"
              accessibilityLabel={t("aiTab.stopReply")}
              style={[styles.send, { backgroundColor: c.inverse }]}
            >
              <View style={[styles.stop, { backgroundColor: c.onInverse }]} />
            </PressableScale>
          ) : (
            <PressableScale
              onPress={onSend}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel={t("aiTab.sendMessage")}
              accessibilityState={{ disabled: !canSend }}
              style={[styles.send, { backgroundColor: canSend ? c.inverse : c.surfaceStrong }]}
            >
              <ArrowUp color={canSend ? c.onInverse : c.textMuted} />
            </PressableScale>
          )}
        </View>

        <View style={styles.meta}>
          {busyElsewhere ? (
            <Text numberOfLines={1} style={[styles.metaText, styles.flex, { color: c.textMuted, fontFamily: f.regular }]}>
              {t("aiTab.chatBusyElsewhere")}
            </Text>
          ) : (
            <View style={[styles.metaLeft, styles.flex]}>
              <Icon name="lock" size={11} color={c.textMuted} strokeWidth={2} />
              <Text numberOfLines={1} style={[styles.metaText, styles.flex, { color: c.textMuted, fontFamily: f.regular }]}>
                {modelName
                  ? `${t("aiTab.chatModel", { model: modelName })} · ${t("aiTab.composer.private")}`
                  : t("aiTab.composer.private")}
              </Text>
            </View>
          )}
          {value.length >= COUNTER_FROM ? (
            <Text style={[styles.metaText, styles.counter, { color: c.textMuted, fontFamily: f.medium }]}>
              {value.length}/{MAX_INPUT}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { position: "absolute", left: 12, right: 12 },
  panel: {
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    paddingBottom: 8,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingLeft: 16, paddingRight: 8 },
  input: { flex: 1, fontSize: 15.5, lineHeight: 21, paddingTop: 10, paddingBottom: 10, maxHeight: 112 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  stop: { width: 12, height: 12, borderRadius: 3 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, marginTop: 2 },
  metaLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 11.5 },
  counter: { fontVariant: ["tabular-nums"] },
});
