import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraChip, AuraField, AuraSheet, PressableScale, showAlert, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { showInterstitial } from "@/modules/ads";
import { useTripsStore, type Group } from "@/features/trips/store/tripsStore";
import { CURRENCY_OPTIONS } from "@/utils/currency";

const EMOJIS = ["👥", "🏠", "💑", "🍕", "🎉", "🏢", "⚽", "🛒"];
const MAX_NAME = 80;

/** Creates a group: name, emoji, currency and the people in it. */
export function NewGroupSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (group: Group) => void }) {
  const { t } = useLocalization();
  return (
    <AuraSheet visible={visible} onClose={onClose} title={t("money.newGroupTitle")}>
      {visible ? <NewGroupBody onClose={onClose} onCreated={onCreated} /> : null}
    </AuraSheet>
  );
}

function NewGroupBody({ onClose, onCreated }: { onClose: () => void; onCreated: (group: Group) => void }) {
  const { c, f } = useAura();
  const { t, currency: defaultCurrency } = useLocalization();
  const createGroup = useTripsStore((state) => state.createGroup);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [person, setPerson] = useState("");
  const [people, setPeople] = useState<string[]>([]);

  const addPerson = () => {
    const next = person.trim().slice(0, MAX_NAME);
    if (!next) return;
    if (!people.some((existing) => existing.toLowerCase() === next.toLowerCase())) setPeople([...people, next]);
    setPerson("");
  };

  const create = () => {
    const trimmed = name.trim().slice(0, MAX_NAME);
    if (!trimmed) {
      showAlert(t("money.groupNameRequired"));
      return;
    }
    const pending = person.trim();
    const companions = pending && !people.some((existing) => existing.toLowerCase() === pending.toLowerCase()) ? [...people, pending] : people;
    const group = createGroup({ name: trimmed, emoji, currency, companions });
    track("group_created", { people: companions.length + 1 });
    onClose();
    onCreated(group);
    showInterstitial("group_created");
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <View style={styles.emojis}>
        {EMOJIS.map((option) => (
          <PressableScale
            key={option}
            onPress={() => setEmoji(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected: option === emoji }}
            style={[styles.emoji, { backgroundColor: option === emoji ? c.surfaceStrong : c.surface, borderColor: option === emoji ? c.text : c.hairline }]}
          >
            <Text style={styles.emojiText}>{option}</Text>
          </PressableScale>
        ))}
      </View>
      <AuraField label={t("money.groupName")} value={name} onChangeText={setName} placeholder={t("money.groupNamePlaceholder")} autoCapitalize="sentences" autoFocus />

      <View style={styles.group}>
        <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("money.groupCurrency")}</Text>
        <View style={styles.chips}>
          {CURRENCY_OPTIONS.map((option) => (
            <AuraChip key={option.code} label={option.code} selected={option.code === currency} onPress={() => setCurrency(option.code)} />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <AuraField
          label={t("money.groupPeople")}
          value={person}
          onChangeText={setPerson}
          placeholder={t("money.personPlaceholder")}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={addPerson}
          blurOnSubmit={false}
        />
        {people.length > 0 ? (
          <View style={styles.chips}>
            {people.map((entry) => (
              <AuraChip key={entry} label={entry} icon="x" selected onPress={() => setPeople(people.filter((existing) => existing !== entry))} />
            ))}
          </View>
        ) : (
          <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("money.groupPeopleHint")}</Text>
        )}
      </View>

      <AuraButton label={t("money.createGroup")} onPress={create} style={styles.create} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 16, gap: 18 },
  emojis: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  emoji: { width: 46, height: 46, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  emojiText: { fontSize: 22 },
  group: { gap: 10 },
  label: { fontSize: 13.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { fontSize: 13 },
  create: { marginTop: 4 },
});
