import React, { useState, type RefObject } from "react";
import { StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import { GlassSurface, Icon, PressableScale, useAura } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { AiGlowRing, GLOW_BLEED } from "./AiGlowRing";

export const MAX_INPUT = 300;
const BUTTON = 32;
const INSET = 7;
const LINE = 21;
// Half the one-line height, so the buttons sit concentric with the pill's ends.
const RADIUS = BUTTON / 2 + INSET;
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
  placeholder: string;
  online?: boolean;
  /** Opens the AI source picker; when set, the status line is tappable. */
  onPickSource?: () => void;
  blurTarget?: RefObject<View | null>;
  onLayout?: (event: LayoutChangeEvent) => void;
}

function ArrowUp({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M12 19V5M5 12l7-7 7 7" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Floating glass composer above the tab bar: source button, input and send / stop. */
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
  placeholder,
  online = false,
  onPickSource,
  blurTarget,
  onLayout,
}: Props) {
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const [focused, setFocused] = useState(false);
  const canSend = value.trim().length > 0 && !busy;
  const lit = generating || focused;
  const privacy = t(online ? "aiTab.composer.online" : "aiTab.composer.private");
  const status = modelName ? `${t("aiTab.chatModel", { model: modelName })} · ${privacy}` : privacy;
  const sourceIcon = (
    <Icon name={online ? "globe" : "lock"} size={15} color={lit ? auraStatusAccent.calm : c.textSoft} strokeWidth={2} />
  );
  const showCounter = value.length >= COUNTER_FROM;

  return (
    <View style={[styles.wrap, { bottom: bottom - GLOW_BLEED }]} pointerEvents="box-none">
      <View style={[styles.panel, { borderColor: c.hairline }]} onLayout={onLayout}>
        <GlassSurface isDark={isDark} radius={RADIUS} blurTarget={blurTarget} />
        <View style={styles.inputRow}>
          {onPickSource ? (
            <PressableScale
              onPress={onPickSource}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={status}
              accessibilityHint={t("aiSource.pickerHint")}
              style={[styles.source, { backgroundColor: c.surfaceStrong }]}
            >
              {sourceIcon}
            </PressableScale>
          ) : (
            <View accessible accessibilityLabel={status} style={[styles.source, { backgroundColor: c.surfaceStrong }]}>
              {sourceIcon}
            </View>
          )}
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
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

        {busyElsewhere || showCounter ? (
          <View style={styles.meta}>
            <Text numberOfLines={1} style={[styles.metaText, styles.flex, { color: c.textMuted, fontFamily: f.regular }]}>
              {busyElsewhere ? t("aiTab.chatBusyElsewhere") : ""}
            </Text>
            {showCounter ? (
              <Text style={[styles.metaText, styles.counter, { color: c.textMuted, fontFamily: f.medium }]}>
                {value.length}/{MAX_INPUT}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <AiGlowRing mode={generating ? "active" : focused ? "focus" : "off"} radius={RADIUS} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { position: "absolute", left: 12 - GLOW_BLEED, right: 12 - GLOW_BLEED, padding: GLOW_BLEED },
  panel: {
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: INSET,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: INSET },
  source: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: "center", justifyContent: "center" },
  // One line is exactly the button height, so text and buttons share a center line.
  input: {
    flex: 1,
    fontSize: 15.5,
    lineHeight: LINE,
    minHeight: BUTTON,
    paddingTop: (BUTTON - LINE) / 2,
    paddingBottom: (BUTTON - LINE) / 2,
    maxHeight: 112,
    includeFontPadding: false,
    textAlignVertical: "top",
  },
  send: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: "center", justifyContent: "center" },
  stop: { width: 10, height: 10, borderRadius: 2.5 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 2 },
  metaText: { fontSize: 11.5 },
  counter: { fontVariant: ["tabular-nums"] },
});
