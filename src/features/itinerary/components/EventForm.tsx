import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { AuraButton } from "@/components/aura/AuraButton";
import { AuraChip } from "@/components/aura/AuraChip";
import { AuraDateField } from "@/components/aura/AuraDateField";
import { AuraField } from "@/components/aura/AuraField";
import { AuraSheet } from "@/components/aura/AuraSheet";
import { auraEventColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { EVENT_TYPES, type EventType } from "@/features/itinerary/constants/eventTypes";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { localizeEventDetail, localizeEventTitle } from "@/features/itinerary/utils/eventText";

export interface EventFormValues {
  type: EventType;
  title: string;
  detail: string;
  startAt: string;
  /** Check-out for a stay, arrival for a transit; undefined when not set. */
  endAt?: string;
}

const DAY_MS = 86_400_000;

/** Sheet to create or edit a single itinerary event; shows Delete when editing. */
export function EventForm({
  event,
  visible,
  onSave,
  onDelete,
  onClose,
}: {
  event: TripEvent | null;
  visible: boolean;
  onSave: (values: EventFormValues) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();

  // The parent remounts this form (via `key`) for each open, so state initializes fresh from props.
  const [type, setType] = useState<EventType>(event?.type ?? "activity");
  const [title, setTitle] = useState(event ? localizeEventTitle(event.title, t) : "");
  const [detail, setDetail] = useState(event ? (localizeEventDetail(event.detail, t) ?? "") : "");
  const [when, setWhen] = useState<Date>(event ? new Date(event.startAt) : new Date());
  const [until, setUntil] = useState<Date>(() =>
    event?.endAt ? new Date(event.endAt) : new Date((event ? new Date(event.startAt) : new Date()).getTime() + DAY_MS),
  );
  // Stays always have a check-out; a transit shows its arrival only when one is known.
  const hasEnd = type === "stay" || (type === "transit" && Boolean(event?.endAt));
  const canSave = title.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    const endAt = hasEnd && until.getTime() > when.getTime() ? until.toISOString() : undefined;
    onSave({ type, title: title.trim(), detail: detail.trim(), startAt: when.toISOString(), endAt });
  };

  return (
    <AuraSheet
      visible={visible}
      onClose={onClose}
      title={event ? t("itinerary.form.editTitle") : t("itinerary.form.addTitle")}
      footer={
        <View style={styles.actions}>
          {event && onDelete ? (
            <AuraButton label={t("itinerary.form.delete")} icon="trash" variant="secondary" onPress={onDelete} style={styles.delete} />
          ) : null}
          <AuraButton
            label={event ? t("itinerary.form.save") : t("itinerary.form.add")}
            onPress={save}
            disabled={!canSave}
            style={styles.flex}
          />
        </View>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.types}>
          {EVENT_TYPES.map((meta) => (
            <AuraChip
              key={meta.id}
              label={t(`itinerary.types.${meta.id}`)}
              icon={meta.icon}
              dot={meta.id === type ? undefined : auraEventColors[meta.id]}
              selected={meta.id === type}
              onPress={() => setType(meta.id)}
            />
          ))}
        </View>
        <AuraField label={t("itinerary.form.title")} value={title} onChangeText={setTitle} placeholder={t("itinerary.form.titlePlaceholder")} returnKeyType="next" />
        <AuraField label={t("itinerary.form.detail")} value={detail} onChangeText={setDetail} placeholder={t("itinerary.form.detailPlaceholder")} />
        <AuraDateField
          label={type === "stay" ? t("itinerary.defaults.checkIn") : type === "transit" ? t("itinerary.defaults.departure") : t("itinerary.form.when")}
          value={when}
          onChange={setWhen}
          withTime
        />
        {hasEnd ? (
          <AuraDateField
            label={type === "stay" ? t("itinerary.defaults.checkOut") : t("itinerary.defaults.arrival")}
            value={until}
            onChange={setUntil}
            withTime
          />
        ) : null}
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8, gap: 18 },
  types: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actions: { flexDirection: "row", gap: 10 },
  delete: { paddingHorizontal: 18 },
  flex: { flex: 1 },
});
