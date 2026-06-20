import React, { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { DatePicker as SwiftDatePicker, Host } from "@expo/ui/swift-ui";
import { datePickerStyle, environment, tint } from "@expo/ui/swift-ui/modifiers";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { EVENT_TYPES, type EventType } from "@/features/itinerary/constants/eventTypes";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";

export interface EventFormValues {
  type: EventType;
  title: string;
  detail: string;
  startAt: string;
}

const TYPE_LABELS: Record<EventType, string> = {
  activity: "Activity",
  transit: "Transit",
  stay: "Stay",
};

function withDate(base: Date, picked: Date): Date {
  const next = new Date(base);
  next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return next;
}

function withTime(base: Date, picked: Date): Date {
  const next = new Date(base);
  next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return next;
}

/** Modal to create or edit a single itinerary event; shows Delete when editing. */
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
  const { nomad, isDark } = useTheme();
  const theme = nomad.colors;
  const { t, locale } = useLocalization();

  // The parent remounts this form (via `key`) for each open, so state initializes
  // fresh from props every time.
  const [type, setType] = useState<EventType>(event?.type ?? "activity");
  const [title, setTitle] = useState(event?.title ?? "");
  const [detail, setDetail] = useState(event?.detail ?? "");
  const [when, setWhen] = useState<Date>(event ? new Date(event.startAt) : new Date());
  // Android opens date then time dialogs in sequence; iOS uses one graphical sheet.
  const [step, setStep] = useState<null | "ios" | "date" | "time">(null);

  const canSave = title.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ type, title: title.trim(), detail: detail.trim(), startAt: when.toISOString() });
  };

  const whenLabel = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(when);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
        <View style={[styles.grabber, { backgroundColor: theme.hairline }]} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.inkDeep }]}>
            {event ? "Edit event" : "Add event"}
          </Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Icon name="x" size={20} color={theme.inkSoft} />
          </Pressable>
        </View>

        <View style={styles.typeRow}>
          {EVENT_TYPES.map((meta) => {
            const active = meta.id === type;
            return (
              <Pressable
                key={meta.id}
                onPress={() => setType(meta.id)}
                style={[
                  styles.typeChip,
                  {
                    backgroundColor: active ? theme[meta.soft] : theme.paper,
                    borderColor: active ? theme[meta.color] : theme.hairline,
                  },
                ]}
              >
                <Icon name={meta.icon} size={15} color={active ? theme[meta.color] : theme.inkSoft} />
                <Text
                  style={[styles.typeChipText, { color: active ? theme[meta.color] : theme.inkSoft }]}
                >
                  {TYPE_LABELS[meta.id]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <FieldShell label="Title" theme={theme}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Train to Ninh Binh"
            placeholderTextColor={theme.inkMuted}
            style={[styles.input, { color: theme.inkDeep }]}
          />
        </FieldShell>

        <FieldShell label="Detail" theme={theme}>
          <TextInput
            value={detail}
            onChangeText={setDetail}
            placeholder="SE2 sleeper · car 4"
            placeholderTextColor={theme.inkMuted}
            style={[styles.input, { color: theme.inkDeep }]}
          />
        </FieldShell>

        <Text style={[styles.fieldLabel, { color: theme.inkMuted }]}>When</Text>
        <Pressable
          onPress={() => setStep(Platform.OS === "ios" ? "ios" : "date")}
          style={[styles.whenButton, { backgroundColor: theme.paper, borderColor: theme.hairline }]}
        >
          <Icon name="calendar" size={16} color={theme.teal} />
          <Text style={[styles.whenText, { color: theme.inkDeep }]}>{whenLabel}</Text>
        </Pressable>

        <View style={styles.actions}>
          {event && onDelete ? (
            <Pressable
              onPress={onDelete}
              style={[styles.deleteButton, { backgroundColor: theme.stampSoft }]}
            >
              <Icon name="trash" size={16} color={theme.stamp} />
              <Text style={[styles.deleteText, { color: theme.stamp }]}>Delete</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            style={[styles.saveButton, { backgroundColor: theme.teal, opacity: canSave ? 1 : 0.45 }]}
          >
            <Text style={[styles.saveText, { color: theme.inverse }]}>
              {event ? "Save changes" : "Add event"}
            </Text>
          </Pressable>
        </View>

        {step === "ios" ? (
          <Modal visible transparent animationType="fade" onRequestClose={() => setStep(null)}>
            <Pressable style={styles.backdrop} onPress={() => setStep(null)} />
            <View style={[styles.pickerSheet, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
              <View style={styles.pickerHeader}>
                <Text style={[styles.title, { color: theme.inkDeep }]}>When</Text>
                <Pressable
                  onPress={() => setStep(null)}
                  style={[styles.doneButton, { backgroundColor: theme.tealSoft }]}
                >
                  <Text style={[styles.doneText, { color: theme.teal }]}>{t("common.ok")}</Text>
                </Pressable>
              </View>
              <Host
                matchContents={{ vertical: true }}
                colorScheme={isDark ? "dark" : "light"}
                ignoreSafeArea="all"
              >
                <SwiftDatePicker
                  selection={when}
                  displayedComponents={["date", "hourAndMinute"]}
                  onDateChange={setWhen}
                  modifiers={[
                    datePickerStyle("graphical"),
                    tint(theme.teal),
                    environment("colorScheme", isDark ? "dark" : "light"),
                  ]}
                />
              </Host>
            </View>
          </Modal>
        ) : null}

        {step === "date" ? (
          <DateTimePicker
            value={when}
            mode="date"
            display="default"
            presentation="dialog"
            accentColor={theme.teal}
            positiveButton={{ label: t("common.ok") }}
            negativeButton={{ label: t("common.cancel") }}
            onDismiss={() => setStep(null)}
            onValueChange={(_, picked) => {
              setWhen((current) => withDate(current, picked));
              setStep("time");
            }}
          />
        ) : null}

        {step === "time" ? (
          <DateTimePicker
            value={when}
            mode="time"
            display="default"
            presentation="dialog"
            accentColor={theme.teal}
            positiveButton={{ label: t("common.ok") }}
            negativeButton={{ label: t("common.cancel") }}
            onDismiss={() => setStep(null)}
            onValueChange={(_, picked) => {
              setWhen((current) => withTime(current, picked));
              setStep(null);
            }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function FieldShell({
  label,
  theme,
  children,
}: {
  label: string;
  theme: ReturnType<typeof useTheme>["nomad"]["colors"];
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.inkMuted }]}>{label}</Text>
      <View style={[styles.inputShell, { backgroundColor: theme.paper, borderColor: theme.hairline }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 36,
    gap: 14,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 20,
  },
  typeRow: {
    flexDirection: "row",
    gap: 8,
  },
  typeChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeChipText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 13,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  inputShell: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    height: 48,
    justifyContent: "center",
  },
  input: {
    fontFamily: NOMAD_FONTS.uiMedium,
    fontSize: 15,
  },
  whenButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    height: 48,
  },
  whenText: {
    fontFamily: NOMAD_FONTS.uiMedium,
    fontSize: 15,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 18,
    height: 50,
    borderRadius: 14,
  },
  deleteText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 15,
  },
  saveButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: 50,
    borderRadius: 14,
  },
  saveText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 15,
  },
  pickerSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  doneButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  doneText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
  },
});
