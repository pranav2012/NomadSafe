import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { AuraButton, Icon, PressableScale, type IconName } from "@/atoms";
import { auraFonts as f, auraSignal, type AuraPalette } from "@/constants/aura";
import { useLocalization } from "@/localization";
import type { EmergencyKind, EmergencyTile } from "@/features/trips/utils/countryFacts";
import { SAFETY_KIND_META } from "./safety/kinds";

export interface PassBackRow {
  icon: IconName;
  tone?: string;
  text: string;
  meta?: string;
  phone?: string | null;
  url?: string | null;
  onPress?: () => void;
}

export type PassBackContent =
  | { kind: "before"; rows: PassBackRow[]; tiles: EmergencyTile[] }
  | { kind: "during"; tiles: EmergencyTile[]; rows: PassBackRow[] }
  | { kind: "after"; stats: { value: string; label: string }[]; onReplay?: () => void };

const KIND_ICON: Record<EmergencyKind, IconName> = { police: "shield", ambulance: "heart", fire: "alertTriangle", general: "phone" };

/** Tap-to-call local emergency numbers, merged where one number covers several services. */
function Tiles({ tiles, palette: c }: { tiles: EmergencyTile[]; palette: AuraPalette }) {
  const { t } = useLocalization();
  return (
    <View style={styles.tiles}>
      {tiles.map((tile) => {
        const label = tile.kinds.map((kind) => t(`passBack.${kind}`)).join(" · ");
        const tone = tile.kinds.includes("police") ? SAFETY_KIND_META.police.color : tile.kinds.includes("general") ? auraSignal.danger : SAFETY_KIND_META.hospital.color;
        return (
          <PressableScale
            key={tile.number}
            onPress={() => void Linking.openURL(`tel:${tile.number}`)}
            accessibilityRole="button"
            accessibilityLabel={t("passBack.callNumber", { service: label, number: tile.number })}
            style={[styles.tile, { backgroundColor: `${tone}22`, borderColor: `${tone}55` }]}
          >
            <View style={styles.tileTop}>
              <Icon name={KIND_ICON[tile.kinds[0]]} size={12} color={tone} />
              <Text style={[styles.tileNumber, { color: c.text }]}>{tile.number}</Text>
            </View>
            <Text numberOfLines={1} style={[styles.tileLabel, { color: c.textSoft }]}>
              {label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const CALL_SLOP = { top: 8, bottom: 8, left: 10, right: 10 };

function Row({ row, palette: c }: { row: PassBackRow; palette: AuraPalette }) {
  const { t } = useLocalization();
  const press = row.onPress ?? (row.url ? () => void Linking.openURL(row.url!) : undefined);
  return (
    <PressableScale disabled={!press} onPress={press} haptic={Boolean(press)} style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: row.tone ? `${row.tone}26` : c.surfaceStrong }]}>
        <Icon name={row.icon} size={12} color={row.tone ?? c.text} />
      </View>
      <Text numberOfLines={1} style={[styles.rowText, { color: c.text }]}>
        {row.text}
      </Text>
      {row.meta ? (
        <Text numberOfLines={1} style={[styles.rowMeta, { color: c.textMuted }]}>
          {row.meta}
        </Text>
      ) : null}
      {row.phone ? (
        <PressableScale
          onPress={() => void Linking.openURL(`tel:${row.phone}`)}
          hitSlop={CALL_SLOP}
          accessibilityRole="button"
          accessibilityLabel={t("home.callPlace", { name: row.text })}
          style={[styles.call, { backgroundColor: c.inverse }]}
        >
          <Icon name="phone" size={11} color={c.onInverse} />
        </PressableScale>
      ) : null}
      {press ? <Icon name="chevronRight" size={12} color={c.textMuted} /> : null}
    </PressableScale>
  );
}

/** The pass's back: what to know before you go, what to do if something goes wrong, or how the trip went. */
export function PassBack({ content, palette: c }: { content: PassBackContent; palette: AuraPalette }) {
  const { t } = useLocalization();
  if (content.kind === "after") {
    return (
      <View style={styles.after}>
        <View style={styles.stats}>
          {content.stats.map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, { color: c.text }]}>
                {stat.value}
              </Text>
              <Text numberOfLines={1} style={[styles.statLabel, { color: c.textMuted }]}>
                {stat.label}
              </Text>
            </View>
          ))}
        </View>
        {content.onReplay ? <AuraButton size="md" icon="play" label={t("passBack.watchReplay")} onPress={content.onReplay} /> : null}
      </View>
    );
  }
  if (content.kind === "before") {
    return (
      <View style={styles.list}>
        {content.rows.map((row) => (
          <Row key={row.text} row={row} palette={c} />
        ))}
        {content.tiles.length > 0 ? (
          <Row
            row={{
              icon: "phone",
              tone: auraSignal.danger,
              text: content.tiles.map((tile) => `${tile.kinds.map((kind) => t(`passBack.${kind}`)).join("/")} ${tile.number}`).join(" · "),
            }}
            palette={c}
          />
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {content.tiles.length > 0 ? <Tiles tiles={content.tiles} palette={c} /> : null}
      {content.rows.map((row) => (
        <Row key={row.text} row={row} palette={c} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6 },
  tiles: { flexDirection: "row", gap: 8, marginBottom: 2 },
  tile: { flex: 1, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 6 },
  tileTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  tileNumber: { fontFamily: f.semibold, fontSize: 18, letterSpacing: 0.5, fontVariant: ["tabular-nums"] },
  tileLabel: { fontFamily: f.medium, fontSize: 11 },
  row: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 26 },
  rowIcon: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowText: { fontFamily: f.medium, fontSize: 13.5, flex: 1 },
  rowMeta: { fontFamily: f.regular, fontSize: 12.5, fontVariant: ["tabular-nums"], maxWidth: 140 },
  call: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  after: { flex: 1, justifyContent: "space-between", paddingBottom: 2 },
  stats: { flexDirection: "row", gap: 10, marginTop: 6 },
  stat: { flex: 1 },
  statValue: { fontFamily: f.semibold, fontSize: 26, letterSpacing: -0.6 },
  statLabel: { fontFamily: f.medium, fontSize: 12 },
});
