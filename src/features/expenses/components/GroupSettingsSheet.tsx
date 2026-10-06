import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraField, AuraListGroup, AuraListRow, AuraSheet, AuraSwitch, PressableScale, showAlert, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { isSettledUp, setGroupArchived } from "@/features/sync";
import { useRemoveGroup } from "@/features/trips/hooks/useRemoveGroup";
import { findMoneyGroup, isArchivedGroup, isTrip, useTripsStore } from "@/features/trips/store/tripsStore";

const EMOJIS = ["👥", "🏠", "💑", "🍕", "🎉", "🏢", "⚽", "🛒", "📥", "✈️"];

/** Name, emoji, how balances are shown, archive, and leave or delete, for one trip or group. */
export function GroupSettingsSheet({ groupId, onClose, onRemoved }: { groupId: string | null; onClose: () => void; onRemoved: () => void }) {
  const { t } = useLocalization();
  return (
    <AuraSheet visible={groupId !== null} onClose={onClose} title={t("groupSettings.title")}>
      {groupId ? <SettingsBody groupId={groupId} onClose={onClose} onRemoved={onRemoved} /> : null}
    </AuraSheet>
  );
}

function SettingsBody({ groupId, onClose, onRemoved }: { groupId: string; onClose: () => void; onRemoved: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const group = useTripsStore((state) => findMoneyGroup(state, groupId));
  const [name, setName] = useState(group?.name ?? "");
  const remove = useRemoveGroup(group, () => {
    onClose();
    onRemoved();
  });
  if (!group) return null;
  const archived = isArchivedGroup(group);

  const update = (patch: { name?: string; emoji?: string; smartSplit?: boolean }) => {
    if (isTrip(group)) useTripsStore.getState().updateTrip(group.id, patch);
    else useTripsStore.getState().updateGroup(group.id, patch);
  };
  const saveName = () => {
    const next = name.trim().slice(0, 80);
    if (next && next !== group.name) update({ name: next });
    else setName(group.name);
  };
  const toggleArchive = () => {
    if (!archived && !isSettledUp(group)) {
      showAlert(t("groupSettings.archiveUnsettledTitle"), t("groupSettings.archiveUnsettledBody"));
      return;
    }
    setGroupArchived(group, !archived)
      .then(() => {
        track("group_archived", { archived: !archived, kind: isTrip(group) ? "trip" : "group" });
        onClose();
        if (!archived) onRemoved();
      })
      .catch(() => showAlert(t("groupTrip.actionFailed")));
  };

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <AuraField label={t("money.groupName")} value={name} onChangeText={setName} onBlur={saveName} onSubmitEditing={saveName} returnKeyType="done" />
      {!isTrip(group) ? (
        <View style={styles.emojis}>
          {EMOJIS.map((option) => {
            const selected = (group.emoji ?? "👥") === option;
            return (
              <PressableScale
                key={option}
                onPress={() => update({ emoji: option })}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.emoji, { backgroundColor: selected ? c.surfaceStrong : c.surface, borderColor: selected ? c.text : c.hairline }]}
              >
                <Text style={styles.emojiText}>{option}</Text>
              </PressableScale>
            );
          })}
        </View>
      ) : null}

      <AuraListGroup footer={group.smartSplit === false ? t("groupSettings.asIsFooter") : t("groupSettings.smartFooter")}>
        <AuraListRow
          icon="swap"
          label={t("groupSettings.smartSplit")}
          detail={group.shared ? t("groupSettings.forEveryone") : undefined}
          trailing={
            <AuraSwitch
              value={group.smartSplit !== false}
              onValueChange={(on) => {
                update({ smartSplit: on });
                track("smart_split_changed", { on });
              }}
              accessibilityLabel={t("groupSettings.smartSplit")}
            />
          }
        />
      </AuraListGroup>

      <AuraListGroup footer={archived ? t("groupSettings.unarchiveFooter") : t("groupSettings.archiveFooter")}>
        <AuraListRow icon="bookmark" label={archived ? t("groupTrip.unarchive") : t("groupTrip.archive")} onPress={toggleArchive} />
      </AuraListGroup>

      {remove ? (
        <AuraButton label={remove.label} icon={remove.icon} variant="secondary" loading={remove.busy} onPress={remove.run} style={styles.remove} />
      ) : null}
      <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{group.shared ? t("groupSettings.sharedNote") : t("groupSettings.localNote")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 16, gap: 16 },
  emojis: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  emoji: { width: 44, height: 44, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  emojiText: { fontSize: 21 },
  remove: { marginTop: 4 },
  note: { fontSize: 12.5, lineHeight: 18 },
});
