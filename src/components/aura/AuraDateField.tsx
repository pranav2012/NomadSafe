import React, { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { DatePicker as SwiftDatePicker, Host } from "@expo/ui/swift-ui";
import { datePickerStyle, environment, tint } from "@expo/ui/swift-ui/modifiers";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { useLocalization } from "@/localization";
import { useAura } from "./useAura";

interface AuraDateFieldProps {
  label?: string;
  value: Date;
  onChange: (date: Date) => void;
  withTime?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
  /** Overrides the formatted value (e.g. "Depart · Sun 2026"). */
  caption?: string;
  compact?: boolean;
}

function withDate(base: Date, picked: Date) {
  const next = new Date(base);
  next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return next;
}

function withClock(base: Date, picked: Date) {
  const next = new Date(base);
  next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return next;
}

/**
 * Date (and optionally time) field. iOS expands the native graphical calendar inline; Android uses
 * the native dialogs (date, then time). Both are tinted with the Aura accent.
 */
export function AuraDateField({ label, value, onChange, withTime = false, minimumDate, maximumDate, caption, compact }: AuraDateFieldProps) {
  const { c, f, accent, isDark } = useAura();
  const { t, locale } = useLocalization();
  const [open, setOpen] = useState<null | "inline" | "date" | "time">(null);

  const formatted = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : { year: compact ? undefined : "numeric" }),
  }).format(value);

  return (
    <Animated.View layout={LinearTransition.duration(200)} style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{label}</Text> : null}
      <PressableScale
        pressedScale={0.98}
        onPress={() => setOpen((current) => (current ? null : Platform.OS === "ios" ? "inline" : "date"))}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}, ${formatted}` : formatted}
        style={[styles.box, { backgroundColor: c.surface, borderColor: open === "inline" ? accent : c.hairline }]}
      >
        <Icon name="calendar" size={16} color={accent} />
        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.value, { color: c.text, fontFamily: f.semibold }]}>
            {formatted}
          </Text>
          {caption ? <Text style={[styles.caption, { color: c.textMuted, fontFamily: f.regular }]}>{caption}</Text> : null}
        </View>
        {Platform.OS === "ios" ? <Icon name={open ? "chevronDown" : "chevronRight"} size={14} color={c.textMuted} /> : null}
      </PressableScale>

      {open === "inline" ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)} style={[styles.inline, { borderColor: c.hairline }]}>
          <Host matchContents={{ vertical: true }} colorScheme={isDark ? "dark" : "light"}>
            <SwiftDatePicker
              selection={value}
              range={{ start: minimumDate, end: maximumDate }}
              displayedComponents={withTime ? ["date", "hourAndMinute"] : ["date"]}
              onDateChange={onChange}
              modifiers={[datePickerStyle("graphical"), tint(accent), environment("colorScheme", isDark ? "dark" : "light")]}
            />
          </Host>
        </Animated.View>
      ) : null}

      {open === "date" ? (
        <DateTimePicker
          value={value}
          mode="date"
          display="default"
          presentation="dialog"
          accentColor={accent}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          positiveButton={{ label: t("common.ok") }}
          negativeButton={{ label: t("common.cancel") }}
          onDismiss={() => setOpen(null)}
          onValueChange={(_, picked) => {
            onChange(withDate(value, picked));
            setOpen(withTime ? "time" : null);
          }}
        />
      ) : null}
      {open === "time" ? (
        <DateTimePicker
          value={value}
          mode="time"
          display="default"
          presentation="dialog"
          accentColor={accent}
          positiveButton={{ label: t("common.ok") }}
          negativeButton={{ label: t("common.cancel") }}
          onDismiss={() => setOpen(null)}
          onValueChange={(_, picked) => {
            onChange(withClock(value, picked));
            setOpen(null);
          }}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 13.5 },
  box: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 8 },
  text: { flex: 1 },
  value: { fontSize: 15.5 },
  caption: { fontSize: 12, marginTop: 1 },
  inline: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 6, overflow: "hidden" },
});
