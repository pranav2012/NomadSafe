import React, { useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { BlurTargetView } from "expo-blur";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AuraCard,
  Icon,
  showToast,
  PressableScale,
  useAura,
  useFloatingBarBottom,
  useKeyboardVisible,
  useTabBarInset,
  AuraTopFade,
} from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { useStartNewGroup, useStartNewTrip } from "@/modules/billing";
import { useAuthStore } from "@/features/auth/store/authStore";
import { shareGroup } from "@/features/sync";
import { useKeepGroupStore } from "@/features/expenses/store/keepGroupStore";
import { findMoneyGroup, isTrip, selectActiveTrip, useTripsStore } from "@/features/trips/store/tripsStore";
import { GroupPeopleSheet } from "@/features/trips/components/GroupPeopleSheet";
import { useExpensesStore, type Expense } from "@/features/expenses/store/expensesStore";
import { OVERVIEW, useMoneySelection, useMoneyViewStore } from "@/features/expenses/store/moneyViewStore";
import { dismissGmailSyncBanner, useTripGmailSyncStatus } from "@/features/expenses/store/gmailSyncStatusStore";
import { dismissGmailLostAccess, hasGmailGrant, useGmailConnectionStore } from "@/features/expenses/store/gmailConnectionStore";
import { SELF_ID } from "@/features/expenses/utils/split";
import { CAPTURE_BAR_HEIGHT, CaptureBar } from "@/features/expenses/components/CaptureBar";
import { ExpenseForm } from "@/features/expenses/components/ExpenseForm";
import { GroupMoney } from "@/features/expenses/components/GroupMoney";
import { ImportSheet } from "@/features/expenses/components/ImportSheet";
import { MoneyOverview } from "@/features/expenses/components/MoneyOverview";
import { MoneySwitcher } from "@/features/expenses/components/MoneySwitcher";
import { NewGroupSheet } from "@/features/expenses/components/NewGroupSheet";
import { ImportFromAppSheet } from "@/features/expenses/components/ImportFromAppSheet";

/** Money tab: the active trip's money (or the Overview with no trip), a switcher to any group, and a floating capture bar. */
export default function ExpensesScreen() {
  const { c, isDark } = useAura();
  const { t } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const keyboardVisible = useKeyboardVisible();
  const blurTarget = useRef<View>(null);
  const activeTrip = useTripsStore(selectActiveTrip);
  const selected = useMoneySelection();
  const select = useMoneyViewStore((state) => state.select);
  const chosen = useTripsStore((state) => (selected && selected !== OVERVIEW ? findMoneyGroup(state, selected) : null));
  const group = selected === OVERVIEW ? null : (chosen ?? activeTrip);
  const viewId = group?.id ?? OVERVIEW;
  const expenses = useExpensesStore((state) => state.expenses);
  const updateExpense = useExpensesStore((state) => state.updateExpense);
  const startNewGroup = useStartNewGroup();
  const startNewTrip = useStartNewTrip();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [importTab, setImportTab] = useState<"paste" | "gmail" | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [appImport, setAppImport] = useState<{ groupId: string | null } | null>(null);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const viewingActiveTrip = !!activeTrip && group?.id === activeTrip.id;
  const gmailAdded = useTripGmailSyncStatus(viewingActiveTrip ? activeTrip.id : undefined).unseenExpenses;
  const gmailLostAccess = useGmailConnectionStore((state) => state.lostAccess && !hasGmailGrant(state.tokens));

  const reviewable = group ? expenses.filter((expense) => expense.groupId === group.id && expense.splitHint?.shares) : [];
  const confirmSplits = () => {
    for (const expense of reviewable) updateExpense(expense.id, { paidBy: SELF_ID, shares: expense.splitHint?.shares, splitHint: undefined });
  };

  const markUsed = useMoneyViewStore((state) => state.markUsed);
  const openAdd = () => {
    markUsed();
    setEditing(null);
    setFormOpen(true);
  };
  const openExpense = (expense: Expense) => {
    markUsed();
    setEditing(expense);
    setFormOpen(true);
  };
  const openVoice = () => {
    setFormOpen(false);
    router.push({ pathname: "/voice-expense", params: group && isTrip(group) ? { tripId: group.id } : {} });
  };

  // A new group with an ended trip's people; on a shared trip its members join it directly.
  const keepAsGroup = () =>
    startNewGroup(() => {
      if (!group || !isTrip(group)) return;
      const trip = group;
      const created = useTripsStore.getState().createGroup({ name: trip.name, emoji: "✈️", currency: trip.currency, companions: trip.companions });
      useKeepGroupStore.getState().markHandled(trip.id);
      track("group_created", { people: trip.companions.length + 1 });
      select(created.id);
      if (trip.shared) {
        const ownerName = useAuthStore.getState().user?.name ?? "";
        shareGroup(created, ownerName.split(" ")[0] || ownerName, trip.shared.groupId)
          .then((sharedId) => select(sharedId))
          .catch(() => showToast(t("groupTrip.actionFailed")));
      }
    });

  const captureBottom = useFloatingBarBottom();

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <BlurTargetView ref={blurTarget} style={styles.root}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={markUsed}
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: tabBarInset + CAPTURE_BAR_HEIGHT + 28 }]}
        >
          <View style={styles.header}>
            <MoneySwitcher selected={viewId} onSelect={select} />
            <View style={styles.headerButtons}>
              {group ? (
                <PressableScale
                  onPress={() => setPeopleOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t("groupTrip.peopleTitle")}
                  style={[styles.headerButton, { backgroundColor: c.surfaceStrong }]}
                >
                  <Icon name="users" size={17} color={c.text} />
                </PressableScale>
              ) : null}
              <PressableScale
                onPress={() => setImportTab("paste")}
                accessibilityRole="button"
                accessibilityLabel={t("expenses.importTitle")}
                style={[styles.headerButton, { backgroundColor: c.surfaceStrong }]}
              >
                <Icon name="download" size={17} color={c.text} />
              </PressableScale>
            </View>
          </View>

          {gmailAdded > 0 && activeTrip ? (
            <Banner icon="mail" text={t("expenses.autoSynced", { count: gmailAdded })} onDismiss={() => dismissGmailSyncBanner(activeTrip.id)} />
          ) : null}
          {reviewable.length > 0 && !reviewDismissed ? (
            <Banner
              icon="users"
              tone={auraStatusAccent.live}
              text={t("split.reviewBanner", { count: reviewable.length })}
              action={{ label: t("split.confirmAll"), onPress: confirmSplits }}
              onDismiss={() => setReviewDismissed(true)}
            />
          ) : null}
          {gmailLostAccess ? (
            <Banner
              icon="mail"
              tone={auraStatusAccent.live}
              text={t("expenses.gmailLostAccess")}
              action={{ label: t("expenses.gmailReconnect"), onPress: () => setImportTab("gmail") }}
              onDismiss={dismissGmailLostAccess}
            />
          ) : null}

          <PrivateView>
            <Animated.View key={viewId} entering={FadeIn.duration(220)}>
              {group ? (
                <GroupMoney
                  group={group}
                  onOpenExpense={openExpense}
                  onAddPeople={() => setPeopleOpen(true)}
                  onImport={() => setImportTab("paste")}
                  onPlanTrip={() => startNewTrip(group.id)}
                  onKeepAsGroup={keepAsGroup}
                />
              ) : (
                <MoneyOverview onOpenGroup={select} onOpenExpense={openExpense} onNewGroup={() => startNewGroup(() => setNewGroupOpen(true))} />
              )}
            </Animated.View>
          </PrivateView>
        </ScrollView>
        <AuraTopFade />
      </BlurTargetView>

      {!keyboardVisible ? (
        <CaptureBar bottom={captureBottom} onAdd={openAdd} onVoice={openVoice} blurTarget={Platform.OS === "android" ? blurTarget : undefined} />
      ) : null}

      <ExpenseForm
        visible={formOpen}
        editingExpense={editing}
        groupId={group?.id ?? null}
        onSave={() => setFormOpen(false)}
        onCancel={() => setFormOpen(false)}
        onSpeak={openVoice}
      />
      <ImportSheet
        visible={importTab !== null}
        groupId={group?.id ?? null}
        trip={group && isTrip(group) ? group : null}
        initialTab={importTab ?? "paste"}
        onClose={() => setImportTab(null)}
        onImported={() => setImportTab(null)}
        onFromApp={() => {
          setImportTab(null);
          setAppImport({ groupId: group?.id ?? null });
        }}
      />
      <ImportFromAppSheet visible={appImport !== null} groupId={appImport?.groupId ?? null} onClose={() => setAppImport(null)} onDone={(id) => select(id)} />
      <GroupPeopleSheet groupId={peopleOpen ? (group?.id ?? null) : null} onClose={() => setPeopleOpen(false)} onDeleted={() => select(OVERVIEW)} />
      <NewGroupSheet
        visible={newGroupOpen}
        onClose={() => setNewGroupOpen(false)}
        onCreated={(created) => select(created.id)}
        onImportFromApp={() => {
          setNewGroupOpen(false);
          setAppImport({ groupId: null });
        }}
      />
    </View>
  );
}

function Banner({
  icon,
  text,
  tone,
  action,
  onDismiss,
}: {
  icon: "mail" | "users";
  text: string;
  tone?: string;
  action?: { label: string; onPress: () => void };
  onDismiss: () => void;
}) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  return (
    <AuraCard tone={tone} style={styles.banner}>
      <View style={styles.bannerRow}>
        <Icon name={icon} size={16} color={tone ?? c.textSoft} />
        <Text style={[styles.bannerText, { color: c.text, fontFamily: f.regular }]}>{text}</Text>
        {action ? (
          <PressableScale onPress={action.onPress} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.bannerAction, { color: c.text, fontFamily: f.semibold }]}>{action.label}</Text>
          </PressableScale>
        ) : null}
        <PressableScale onPress={onDismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.close")}>
          <Icon name="x" size={15} color={c.textMuted} />
        </PressableScale>
      </View>
    </AuraCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerButtons: { flexDirection: "row", gap: 8 },
  headerButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  banner: { marginBottom: 12, paddingVertical: 12 },
  bannerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bannerText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  bannerAction: { fontSize: 13.5 },
});
