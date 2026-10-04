import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/atoms/nomad/Icon";
import { PressableScale } from "@/atoms/motion/PressableScale";
import { useAura } from "./useAura";

/** Rounded group of list rows with an optional caption above and footnote below. */
export function AuraListGroup({
  title,
  footer,
  children,
  style,
}: {
  title?: string;
  footer?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, f } = useAura();
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, style]}>
      {title ? <Text style={[styles.title, { color: c.textMuted, fontFamily: f.medium }]}>{title}</Text> : null}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
        {rows.map((row, index) => (
          <View key={index}>
            {index > 0 ? <View style={[styles.divider, { backgroundColor: c.hairline }]} /> : null}
            {row}
          </View>
        ))}
      </View>
      {footer ? <Text style={[styles.footer, { color: c.textMuted, fontFamily: f.regular }]}>{footer}</Text> : null}
    </View>
  );
}

interface AuraListRowProps {
  icon?: IconName;
  /** Tint for the icon tile; defaults to neutral. */
  tone?: string;
  label: string;
  detail?: string;
  /** Right-aligned value text (e.g. the current choice). */
  value?: string;
  /** Right-side control, e.g. an AuraSwitch. Replaces the chevron. */
  trailing?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}

/** One settings-style row: icon tile, label and detail, then a value, control or chevron. */
export function AuraListRow({ icon, tone, label, detail, value, trailing, onPress, destructive, disabled, accessibilityHint }: AuraListRowProps) {
  const { c, f } = useAura();
  const fg = destructive ? "#FF4D5E" : c.text;
  const content = (
    <>
      {icon ? (
        <View style={[styles.iconTile, { backgroundColor: tone ? `${tone}24` : c.surfaceStrong }]}>
          <Icon name={icon} size={17} color={destructive ? fg : (tone ?? c.text)} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={[styles.label, { color: fg, fontFamily: f.medium }]}>{label}</Text>
        {detail ? (
          <Text style={[styles.detail, { color: c.textMuted, fontFamily: f.regular }]} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.value, { color: c.textMuted, fontFamily: f.regular }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing ?? (onPress && !destructive ? <Icon name="chevronRight" size={16} color={c.textMuted} /> : null)}
    </>
  );

  if (!onPress) return <View style={[styles.row, disabled && styles.disabled]}>{content}</View>;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic={false}
      pressedScale={0.985}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={accessibilityHint}
      style={[styles.row, disabled && styles.disabled]}
    >
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: 26 },
  title: { fontSize: 13, marginBottom: 8, marginLeft: 4 },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 62 },
  footer: { fontSize: 12.5, lineHeight: 18, marginTop: 8, marginHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10 },
  disabled: { opacity: 0.45 },
  iconTile: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 2 },
  label: { fontSize: 15.5 },
  detail: { fontSize: 12.5, lineHeight: 17 },
  value: { fontSize: 14.5, maxWidth: 150 },
});
