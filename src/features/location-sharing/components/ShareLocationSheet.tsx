import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraChip, AuraSheet, Icon, PressableScale, useAura } from "@/atoms";
import { PrivateView } from "@/modules/analytics";
import { useLocalization } from "@/localization";
import { SHARE_DURATIONS } from "../store/sharingStore";
import type { CirclePerson } from "../utils/circle";
import { CircleAvatar } from "./CircleAvatar";

interface ShareLocationSheetProps {
  visible: boolean;
  onClose: () => void;
  people: CirclePerson[];
  isBroadcasting: boolean;
  busy: boolean;
  accent: string;
  duration: number | null;
  /** When the running share stops, as a label; null while not sharing or when it has no end. */
  endsAtLabel: string | null;
  onDurationChange: (duration: number | null) => void;
  onToggleSeesYou: (userId: string, on: boolean) => Promise<void>;
  onStart: (recipients: number) => void;
  onStop: () => void;
  onAddPeople: () => void;
}

/**
 * Who sees you and for how long. Choices apply right away and the server remembers them, so the
 * next share starts with the same people.
 */
export function ShareLocationSheet({
  visible,
  onClose,
  people,
  isBroadcasting,
  busy,
  accent,
  duration,
  endsAtLabel,
  onDurationChange,
  onToggleSeesYou,
  onStart,
  onStop,
  onAddPeople,
}: ShareLocationSheetProps) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  // Optimistic choices until the server's shares catch up.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const candidates = people.filter((p) => p.userId && (p.status === "accepted" || p.status === "pending"));
  const isOn = (person: CirclePerson) => (person.userId && person.userId in overrides ? overrides[person.userId] : person.seesYou);
  const selected = candidates.filter((p) => p.status === "accepted" && isOn(p)).length;

  const toggle = (person: CirclePerson) => {
    const userId = person.userId;
    if (!userId || person.status !== "accepted") return;
    const next = !isOn(person);
    setOverrides((prev) => ({ ...prev, [userId]: next }));
    onToggleSeesYou(userId, next).catch(() =>
      setOverrides((prev) => {
        const rest = { ...prev };
        delete rest[userId];
        return rest;
      }),
    );
  };

  const close = () => {
    setOverrides({});
    onClose();
  };

  const footer = isBroadcasting ? (
    <AuraButton label={t("sharing.stopBroadcasting")} icon="pause" variant="secondary" loading={busy} onPress={onStop} />
  ) : candidates.length === 0 ? (
    <AuraButton label={t("circle.addPerson")} icon="plus" onPress={onAddPeople} />
  ) : (
    <AuraButton
      label={t("sharing.startWith", { count: selected })}
      icon="mapPin"
      loading={busy}
      disabled={selected === 0}
      onPress={() => onStart(selected)}
    />
  );

  return (
    <AuraSheet
      visible={visible}
      onClose={close}
      title={isBroadcasting ? t("sharing.liveTitle") : t("sharing.sheetTitle")}
      subtitle={isBroadcasting ? (endsAtLabel ?? t("sharing.noEnd")) : t("sharing.sheetSubtitle")}
      footer={footer}
    >
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={[styles.label, { color: c.textMuted, fontFamily: f.medium }]}>{t("sharing.whoSeesYou")}</Text>
        <PrivateView>
          {candidates.length === 0 ? (
            <Text style={[styles.empty, { color: c.textSoft, fontFamily: f.regular }]}>{t("sharing.noCircleYet")}</Text>
          ) : (
            candidates.map((person, i) => {
              const accepted = person.status === "accepted";
              const on = accepted && isOn(person);
              return (
                <PressableScale
                  key={person.key}
                  onPress={() => toggle(person)}
                  disabled={!accepted}
                  pressedScale={0.99}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: !accepted }}
                  accessibilityLabel={person.name}
                  style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }]}
                >
                  <CircleAvatar name={person.name} size={36} muted={!accepted} />
                  <View style={styles.rowText}>
                    <Text numberOfLines={1} style={[styles.name, { color: c.text, fontFamily: f.semibold }]}>{person.name}</Text>
                    {!accepted ? (
                      <Text style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>{t("circle.pending")}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.box, { borderColor: on ? accent : c.hairline, backgroundColor: on ? accent : "transparent" }]}>
                    {on ? <Icon name="check" size={14} color="#FFFFFF" strokeWidth={2.6} /> : null}
                  </View>
                </PressableScale>
              );
            })
          )}
        </PrivateView>

        {!isBroadcasting && candidates.length > 0 ? (
          <>
            <Text style={[styles.label, styles.spaced, { color: c.textMuted, fontFamily: f.medium }]}>{t("sharing.shareFor")}</Text>
            <View style={styles.durations} accessibilityRole="radiogroup">
              {SHARE_DURATIONS.map((option) => (
                <AuraChip
                  key={option ?? "open"}
                  label={option === null ? t("sharing.durationUntilStopped") : t("sharing.durationHours", { count: Math.round(option / 3_600_000) })}
                  selected={duration === option}
                  onPress={() => onDurationChange(option)}
                />
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.note}>
          <Icon name="lock" size={13} color={c.textMuted} />
          <Text style={[styles.noteText, { color: c.textMuted, fontFamily: f.regular }]}>{t("sharing.privacyNote")}</Text>
        </View>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 8 },
  label: { fontSize: 13, marginBottom: 4 },
  spaced: { marginTop: 18, marginBottom: 10 },
  empty: { fontSize: 14, lineHeight: 20, paddingVertical: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15 },
  sub: { fontSize: 12.5 },
  box: { width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  durations: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 18 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17 },
});
