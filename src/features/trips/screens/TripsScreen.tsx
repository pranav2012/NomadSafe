import React, { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { TripForm } from "@/features/trips/components/TripForm";
import { type Trip, useTripsStore } from "@/features/trips/store/tripsStore";
import { useChatStore } from "@/features/ai/store/chatStore";

function getTripProgress(trip: Trip) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(trip.startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(trip.endDate);
  end.setHours(0, 0, 0, 0);

  if (today < start) return "upcoming" as const;
  if (today > end) return "complete" as const;
  return "active" as const;
}

function countDays(trip: Trip) {
  const start = new Date(trip.startDate);
  const end = new Date(trip.endDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / msPerDay) + 1);
}

function formatTripDates(trip: Trip, locale: string) {
  const start = new Date(trip.startDate);
  const end = new Date(trip.endDate);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const endFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  return `${startFormatter.format(start)} — ${endFormatter.format(end)}`;
}

export default function TripsScreen() {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t, locale } = useLocalization();
  const router = useRouter();
  const trips = useTripsStore((state) => state.trips);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const setActiveTrip = useTripsStore((state) => state.setActiveTrip);
  const deleteTrip = useTripsStore((state) => state.deleteTrip);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Trip | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const activeTrip = trips.find((trip) => trip.id === activeTripId) ?? null;

  const { upcoming, past } = useMemo(() => {
    const remaining = trips.filter((trip) => trip.id !== activeTrip?.id);
    return {
      upcoming: remaining.filter((trip) => getTripProgress(trip) === "upcoming"),
      past: remaining.filter((trip) => {
        const progress = getTripProgress(trip);
        return progress === "active" || progress === "complete";
      }),
    };
  }, [trips, activeTrip]);

  const handleOpenCreate = () => {
    setEditingTrip(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (trip: Trip) => {
    setEditingTrip(trip);
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingTrip(null);
  };

  const handleSwitchActive = (tripId: string) => {
    setActiveTrip(tripId);
  };

  const handleInitiateDelete = (trip: Trip) => {
    setDeleteTarget(trip);
    setConfirmText("");
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    if (confirmText.trim().toLowerCase() !== "confirm") {
      Alert.alert(t("trip.deleteConfirmErrorTitle"), t("trip.deleteConfirmErrorBody"));
      return;
    }
    deleteTrip(deleteTarget.id);
    useChatStore.getState().removeConversation(deleteTarget.id);
    setDeleteTarget(null);
    setConfirmText("");
  };

  const handleCancelDelete = () => {
    setDeleteTarget(null);
    setConfirmText("");
  };

  const totalTrips = trips.length;

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.root, { backgroundColor: theme.paper }]}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>
              {t("trip.tripsCount", { count: totalTrips })}
            </Text>
            <Text style={[styles.heroTitle, { color: theme.inkDeep }]}>
              {t("trip.tripsTitle")}
            </Text>
          </View>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.closeButton,
              {
                backgroundColor: theme.paperSoft,
                borderColor: theme.hairline,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Icon name="close" size={18} color={theme.inkSoft} />
          </Pressable>
        </View>

        {activeTrip ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.teal }]}>
              {t("trip.activeNow")}
            </Text>
            <ActiveTripCard
              trip={activeTrip}
              locale={locale}
              theme={theme}
              t={t}
              onPress={() => router.back()}
              onEdit={() => handleOpenEdit(activeTrip)}
              onDelete={() => handleInitiateDelete(activeTrip)}
            />
          </View>
        ) : null}

        {upcoming.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>
              {t("trip.upcoming")}
            </Text>
            <Animated.View layout={LinearTransition.duration(220)} style={styles.list}>
              {upcoming.map((trip, index) => (
                <Animated.View key={trip.id} entering={FadeInDown.duration(220).delay(index * 40)}>
                  <TripRow
                    trip={trip}
                    locale={locale}
                    theme={theme}
                    t={t}
                    onPress={() => handleSwitchActive(trip.id)}
                    onEdit={() => handleOpenEdit(trip)}
                    onDelete={() => handleInitiateDelete(trip)}
                  />
                </Animated.View>
              ))}
            </Animated.View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>
            {past.length > 0 ? t("trip.past") : t("trip.allTrips")}
          </Text>
          <Animated.View layout={LinearTransition.duration(220)} style={styles.list}>
            {past.length === 0 && upcoming.length === 0 && !activeTrip ? (
              <View
                style={[
                  styles.emptyCard,
                  { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
                ]}
              >
                <Icon name="compass" size={28} color={theme.inkMuted} />
                <Text style={[styles.emptyTitle, { color: theme.inkDeep }]}>
                  {t("trip.noTripsTitle")}
                </Text>
                <Text style={[styles.emptyBody, { color: theme.inkSoft }]}>
                  {t("trip.noTripsBody")}
                </Text>
              </View>
            ) : (
              past.map((trip, index) => (
                <Animated.View key={trip.id} entering={FadeInDown.duration(220).delay(index * 40)}>
                  <TripRow
                    trip={trip}
                    locale={locale}
                    theme={theme}
                    t={t}
                    onPress={() => handleSwitchActive(trip.id)}
                    onEdit={() => handleOpenEdit(trip)}
                    onDelete={() => handleInitiateDelete(trip)}
                  />
                </Animated.View>
              ))
            )}
          </Animated.View>
        </View>

        <Pressable
          onPress={handleOpenCreate}
          style={({ pressed }) => [
            styles.addTripButton,
            {
              borderColor: theme.teal,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Icon name="plus" size={18} color={theme.teal} />
          <Text style={[styles.addTripText, { color: theme.teal }]}>
            {t("trip.addTrip")}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={isFormOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={handleCloseForm}
      >
        <SafeAreaView
          edges={["top"]}
          style={[styles.formRoot, { backgroundColor: theme.paper }]}
        >
          <View style={styles.formHeader}>
            <Pressable onPress={handleCloseForm} hitSlop={12}>
              <Icon name="x" size={24} color={theme.inkDeep} />
            </Pressable>
          </View>
          <TripForm
            editingTrip={editingTrip}
            onSave={handleCloseForm}
            onCancel={handleCloseForm}
          />
        </SafeAreaView>
      </Modal>

      <Modal
        visible={deleteTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={handleCancelDelete}
      >
        <Pressable
          style={[styles.deleteBackdrop, { backgroundColor: "rgba(0,0,0,0.5)" }]}
          onPress={handleCancelDelete}
        >
          <View
            style={[
              styles.deleteSheet,
              { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[styles.deleteIcon, { backgroundColor: theme.stampSoft }]}>
              <Icon name="trash" size={22} color={theme.stamp} />
            </View>
            <Text style={[styles.deleteTitle, { color: theme.inkDeep }]}>
              {t("trip.deleteTitle")}
            </Text>
            <Text style={[styles.deleteBody, { color: theme.inkSoft }]}>
              {t("trip.deleteBody", { name: deleteTarget?.name ?? "" })}
            </Text>

            <Text style={[styles.deletePrompt, { color: theme.inkMuted }]}>
              {t("trip.deletePrompt")}
            </Text>
            <TextInput
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t("trip.deletePlaceholder")}
              placeholderTextColor={theme.inkMuted}
              style={[
                styles.confirmInput,
                {
                  color: theme.inkDeep,
                  backgroundColor: theme.paper,
                  borderColor: theme.hairline,
                },
              ]}
            />

            <View style={styles.deleteActions}>
              <Pressable
                onPress={handleCancelDelete}
                style={[
                  styles.deleteAction,
                  {
                    backgroundColor: theme.paper,
                    borderColor: theme.hairline,
                    borderWidth: 1,
                  },
                ]}
              >
                <Text style={[styles.deleteActionText, { color: theme.inkDeep }]}>
                  {t("common.cancel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmDelete}
                style={[styles.deleteAction, { backgroundColor: theme.stamp }]}
              >
                <Text style={[styles.deleteActionText, { color: theme.inverse }]}>
                  {t("trip.deleteConfirm")}
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function ActiveTripCard({
  trip,
  locale,
  theme,
  t,
  onPress,
  onEdit,
  onDelete,
}: {
  trip: Trip;
  locale: string;
  theme: ReturnType<typeof useTheme>["nomad"]["colors"];
  t: ReturnType<typeof useLocalization>["t"];
  onPress: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const progress = getTripProgress(trip);
  const duration = countDays(trip);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(trip.startDate);
  start.setHours(0, 0, 0, 0);
  const elapsedDays = Math.max(
    1,
    Math.round((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  const day = progress === "upcoming" ? 0 : Math.min(elapsedDays, duration);
  const percent = duration > 0 ? Math.min(100, (day / duration) * 100) : 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.activeCard,
        {
          backgroundColor: theme.teal,
          borderColor: theme.teal,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={styles.activeCardTop}>
        <View style={styles.activeCardHeaderRow}>
          <View style={[styles.activeCardIcon, { backgroundColor: theme.whiteOverlay }]}>
            <Icon name="mapPin" size={21} color={theme.inverse} />
          </View>
          <Text style={[styles.currentLabel, { color: theme.whiteText }]}>
            {t("trip.currentTrip")}
          </Text>
        </View>
        <View style={[styles.openBadge, { backgroundColor: theme.whiteOverlay }]}>
          <Text style={[styles.openBadgeText, { color: theme.inverse }]}>
            {t("trip.open")}
          </Text>
          <Icon name="chevronRight" size={12} color={theme.inverse} />
        </View>
      </View>

      <Text style={[styles.activeCardName, { color: theme.inverse }]} numberOfLines={2}>
        {trip.name}
      </Text>
      <Text style={[styles.activeCardSub, { color: theme.whiteTextMuted }]}>
        {formatTripDates(trip, locale)} · {trip.destinations.join(" · ")}
      </Text>

      <View style={[styles.progressTrack, { backgroundColor: theme.whiteOverlay }]}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${percent}%`,
              backgroundColor: theme.inverse,
            },
          ]}
        />
      </View>
      <View style={styles.progressMeta}>
        <Text style={[styles.progressText, { color: theme.whiteText }]}>
          {t("trip.dayProgress", { day, total: duration })}
        </Text>
        <Text style={[styles.progressText, { color: theme.whiteText }]}>
          {Math.round(percent)}%
        </Text>
      </View>

      <View style={styles.activeCardActions}>
        <Pressable
          onPress={onEdit}
          style={({ pressed }) => [
            styles.activeActionButton,
            {
              backgroundColor: theme.whiteOverlay,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Icon name="edit" size={14} color={theme.inverse} />
          <Text style={[styles.activeActionButtonText, { color: theme.inverse }]}>
            {t("trip.edit")}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          style={({ pressed }) => [
            styles.activeActionButton,
            {
              backgroundColor: theme.whiteOverlay,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Icon name="trash" size={14} color={theme.inverse} />
          <Text style={[styles.activeActionButtonText, { color: theme.inverse }]}>
            {t("trip.delete")}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function TripRow({
  trip,
  locale,
  theme,
  t,
  onPress,
  onEdit,
  onDelete,
}: {
  trip: Trip;
  locale: string;
  theme: ReturnType<typeof useTheme>["nomad"]["colors"];
  t: ReturnType<typeof useLocalization>["t"];
  onPress: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const progress = getTripProgress(trip);
  const statusLabel =
    progress === "active"
      ? t("trip.activeNow")
      : progress === "upcoming"
        ? t("trip.upcoming")
        : t("trip.completed");

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tripRow,
        {
          backgroundColor: theme.paperSoft,
          borderColor: theme.hairline,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.tripRowTop}>
        <View style={styles.tripRowMeta}>
          <Text style={[styles.tripRowName, { color: theme.inkDeep }]} numberOfLines={1}>
            {trip.name}
          </Text>
          <Text style={[styles.tripRowSub, { color: theme.inkSoft }]} numberOfLines={1}>
            {formatTripDates(trip, locale)} · {trip.destinations.join(" · ")}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: theme.tealSoft }]}>
          <Text style={[styles.statusBadgeText, { color: theme.teal }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.tripRowActions}>
        <Pressable
          onPress={onEdit}
          style={({ pressed }) => [
            styles.actionButton,
            {
              backgroundColor: theme.paper,
              borderColor: theme.hairline,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Icon name="edit" size={14} color={theme.inkSoft} />
          <Text style={[styles.actionButtonText, { color: theme.inkSoft }]}>{t("trip.edit")}</Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          style={({ pressed }) => [
            styles.actionButton,
            {
              backgroundColor: theme.stampSoft,
              borderColor: "transparent",
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Icon name="trash" size={14} color={theme.stamp} />
          <Text style={[styles.actionButtonText, { color: theme.stamp }]}>{t("trip.delete")}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 120,
  },
  header: {
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  eyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  heroTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 38,
    lineHeight: 40,
    letterSpacing: -0.6,
    marginTop: 4,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    marginTop: 6,
    marginBottom: 14,
    gap: 8,
  },
  sectionLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    paddingHorizontal: 6,
  },
  list: {
    gap: 8,
  },
  activeCard: {
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
    padding: 18,
    gap: 12,
  },
  activeCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  activeCardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  activeCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  currentLabel: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
  },
  openBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  openBadgeText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9,
    letterSpacing: 0.6,
  },
  activeCardName: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 27,
    lineHeight: 31,
    letterSpacing: -0.4,
  },
  activeCardSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    overflow: "hidden",
    marginTop: 4,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  progressMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressText: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  tripRow: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  tripRowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  tripRowMeta: {
    flex: 1,
    gap: 2,
  },
  tripRowName: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 15,
  },
  tripRowSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12.5,
    lineHeight: 17,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusBadgeText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9.5,
    letterSpacing: 0.4,
  },
  activeCardActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
  },
  activeActionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    paddingVertical: 9,
  },
  activeActionButtonText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 13,
  },
  tripRowActions: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 9,
  },
  actionButtonText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 13,
  },
  addTripButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 4,
  },
  addTripText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 15,
  },
  emptyCard: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 18,
    padding: 24,
    gap: 10,
  },
  emptyTitle: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 16,
  },
  emptyBody: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  formRoot: {
    flex: 1,
  },
  formHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    alignItems: "flex-start",
  },
  deleteBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  deleteSheet: {
    width: "100%",
    maxWidth: 400,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
  },
  deleteIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  deleteTitle: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 18,
    textAlign: "center",
  },
  deleteBody: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 6,
  },
  deletePrompt: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 18,
    marginBottom: 6,
  },
  confirmInput: {
    width: "100%",
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 15,
  },
  deleteActions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
    marginTop: 18,
  },
  deleteAction: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  deleteActionText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
  },
});
