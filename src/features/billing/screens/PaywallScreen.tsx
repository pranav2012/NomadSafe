import React, { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuraButton, AuraCard, AuraLoader, AuraSegmented, Icon, PressableScale, showAlert, showToast, useAura } from "@/atoms";
import { auraStatusColors } from "@/constants/aura";
import { LEGAL_URLS, openLegalPage } from "@/constants/legal";
import { useLocalization } from "@/localization";
import { logger } from "@/modules/logger";
import { track } from "@/modules/analytics";
import { selectionChanged, successNotification } from "@/utils/haptics";
import {
  FREE_TRIP_LIMIT,
  PACKAGE_IDS,
  freeTrialDays,
  introEligibleProducts,
  loadPackages,
  purchase,
  restorePurchases,
  usePlan,
  type PackageId,
  type PlanTier,
  type PurchasesPackage,
} from "@/modules/billing";
import { useSheetTopInset } from "@/hooks/useSheetTopInset";

type PaidTier = Exclude<PlanTier, "free">;
type Reason = "trips" | "ai" | "settings";

const [INDIGO, TEAL, VIOLET] = auraStatusColors.calm;
const TIER_RANK: Record<PlanTier, number> = { free: 0, plus: 1, pro: 2 };

const STORE_COPY =
  Platform.OS === "ios"
    ? ({ unavailable: "paywall.unavailableIos", renewalTerms: "paywall.renewalTermsIos" } as const)
    : ({ unavailable: "paywall.unavailable", renewalTerms: "paywall.renewalTerms" } as const);

const PACKAGES_BY_TIER: Record<PaidTier, PackageId[]> = {
  plus: [PACKAGE_IDS.plusAnnual, PACKAGE_IDS.plusMonthly, PACKAGE_IDS.plusLifetime],
  pro: [PACKAGE_IDS.proAnnual, PACKAGE_IDS.proMonthly],
};

function periodOf(id: PackageId) {
  if (id.endsWith("lifetime")) return "lifetime" as const;
  return id.endsWith("annual") ? ("annual" as const) : ("monthly" as const);
}

/** Yearly saving against twelve monthly payments, as a whole percentage. */
function annualSaving(annual?: PurchasesPackage, monthly?: PurchasesPackage): number | null {
  if (!annual || !monthly || monthly.product.price <= 0) return null;
  const saving = Math.round((1 - annual.product.price / (monthly.product.price * 12)) * 100);
  return saving > 0 ? saving : null;
}

/** Free, Plus and Pro, sold through Google Play / the App Store via RevenueCat. */
export default function PaywallScreen() {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sheetTop = useSheetTopInset();
  const { reason = "settings" } = useLocalSearchParams<{ reason?: Reason }>();
  const plan = usePlan();
  const [tier, setTier] = useState<PaidTier>(reason === "ai" || plan.tier === "plus" ? "pro" : "plus");
  const [packages, setPackages] = useState<Partial<Record<PackageId, PurchasesPackage>> | null>(null);
  const [selected, setSelected] = useState<PackageId>(PACKAGES_BY_TIER[tier][0]);
  const [busy, setBusy] = useState<"buy" | "restore" | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [introEligible, setIntroEligible] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    track("paywall_viewed", { reason });
  }, [reason]);

  useEffect(() => {
    if (!plan.billingAvailable) return;
    loadPackages()
      .then((loaded) => {
        setPackages(loaded);
        introEligibleProducts(Object.values(loaded))
          .then(setIntroEligible)
          .catch((error: unknown) => logger.warn("paywall", "trial eligibility failed", error));
      })
      .catch((error: unknown) => {
        logger.warn("paywall", "offerings failed", error);
        setLoadFailed(true);
      });
  }, [plan.billingAvailable]);

  const choose = (next: PaidTier) => {
    setTier(next);
    setSelected(PACKAGES_BY_TIER[next][0]);
  };

  const pkg = packages?.[selected];
  const trialDays = tier === "pro" && pkg ? freeTrialDays(pkg, introEligible.has(pkg.product.identifier)) : null;
  const owned = TIER_RANK[plan.tier] >= TIER_RANK[tier];
  const saving = annualSaving(packages?.[PACKAGES_BY_TIER[tier][0]], packages?.[PACKAGES_BY_TIER[tier][1]]);

  const features =
    tier === "plus"
      ? [t("paywall.featureUnlimitedTrips"), t("paywall.featureNoAds"), t("paywall.featureEverything"), t("paywall.featureOfflineAi"), t("paywall.featureOwnKey")]
      : [t("paywall.featureUnlimitedTrips"), t("paywall.featureNoAds"), t("paywall.featureCloudAi"), t("paywall.featureOfflineFallback"), t("paywall.featureOwnKey")];

  const title =
    reason === "trips"
      ? t("paywall.titleTrips", { count: FREE_TRIP_LIMIT })
      : reason === "ai"
        ? t("paywall.titleAi")
        : t("paywall.title");

  const handleBuy = async () => {
    if (!pkg || busy) return;
    setBusy("buy");
    try {
      const outcome = await purchase(pkg);
      if (outcome === "cancelled") return;
      track("purchase_completed", { tier, period: periodOf(selected), trial: trialDays !== null });
      successNotification();
      showToast(t("paywall.thanksTitle"), tier === "pro" ? t("paywall.thanksPro") : t("paywall.thanksPlus"));
      router.back();
    } catch (error) {
      logger.warn("paywall", "purchase failed", error);
      showAlert(t("paywall.failedTitle"), t("paywall.failedBody"));
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    if (busy) return;
    setBusy("restore");
    try {
      const restored = await restorePurchases();
      track("purchases_restored", { tier: restored });
      if (restored === "free") {
        showAlert(t("paywall.restoreNoneTitle"), t("paywall.restoreNoneBody"));
      } else {
        showToast(t("paywall.restoreDoneTitle"), t(restored === "pro" ? "paywall.restoreDonePro" : "paywall.restoreDonePlus"));
        router.back();
      }
    } catch (error) {
      logger.warn("paywall", "restore failed", error);
      showAlert(t("paywall.failedTitle"), t("paywall.restoreFailedBody"));
    } finally {
      setBusy(null);
    }
  };

  const periodLabel = (id: PackageId) => t(`paywall.period_${periodOf(id)}`);
  const priceDetail = (id: PackageId, item: PurchasesPackage) => {
    const period = periodOf(id);
    if (period === "lifetime") return t("paywall.payOnce");
    if (period === "annual" && item.product.pricePerMonthString) return t("paywall.perMonthEquivalent", { price: item.product.pricePerMonthString });
    return null;
  };

  const ctaLabel = owned
    ? t("paywall.currentPlan")
    : trialDays
      ? t("paywall.startTrial", { count: trialDays })
      : pkg
        ? t("paywall.continueWithPrice", { price: pkg.product.priceString })
        : t("common.continue");

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: sheetTop + 16, paddingBottom: 24 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={[styles.eyebrow, { color: c.textMuted, fontFamily: f.medium }]}>{t("paywall.eyebrow")}</Text>
            <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{title}</Text>
          </View>
          <PressableScale
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            style={[styles.close, { backgroundColor: c.surfaceStrong }]}
          >
            <Icon name="x" size={16} color={c.text} />
          </PressableScale>
        </View>
        <Text style={[styles.lede, { color: c.textSoft, fontFamily: f.regular }]}>
          {reason === "trips" ? t("paywall.ledeTrips", { count: FREE_TRIP_LIMIT }) : t("paywall.lede", { count: FREE_TRIP_LIMIT })}
        </Text>

        <AuraSegmented
          options={[
            { value: "plus", label: t("paywall.tierPlus") },
            { value: "pro", label: t("paywall.tierPro") },
          ]}
          value={tier}
          onChange={choose}
          style={styles.segmented}
        />

        <AuraCard tone={tier === "pro" ? VIOLET : INDIGO} style={styles.card}>
          <Text style={[styles.cardTitle, { color: c.text, fontFamily: f.semibold }]}>
            {tier === "pro" ? t("paywall.proTagline") : t("paywall.plusTagline")}
          </Text>
          {features.map((feature) => (
            <View key={feature} style={styles.feature}>
              <Icon name="check" size={16} color={TEAL} strokeWidth={2.4} />
              <Text style={[styles.featureText, { color: c.textSoft, fontFamily: f.regular }]}>{feature}</Text>
            </View>
          ))}
        </AuraCard>

        {!plan.billingAvailable ? (
          <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("paywall.notOffered")}</Text>
        ) : loadFailed || (packages !== null && PACKAGES_BY_TIER[tier].every((id) => !packages[id])) ? (
          <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t(STORE_COPY.unavailable)}</Text>
        ) : packages === null ? (
          <AuraLoader size={56} style={styles.loading} />
        ) : (
          <View style={styles.options} accessibilityRole="radiogroup">
            {PACKAGES_BY_TIER[tier].map((id) => {
              const item = packages[id];
              if (!item) return null;
              const active = id === selected;
              const detail = priceDetail(id, item);
              return (
                <PressableScale
                  key={id}
                  onPress={() => {
                    selectionChanged();
                    setSelected(id);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.option,
                    { backgroundColor: c.surface, borderColor: active ? c.text : c.hairline, borderWidth: active ? 1.5 : StyleSheet.hairlineWidth },
                  ]}
                >
                  <View style={styles.flex}>
                    <View style={styles.optionTitleRow}>
                      <Text style={[styles.optionTitle, { color: c.text, fontFamily: f.semibold }]}>{periodLabel(id)}</Text>
                      {periodOf(id) === "annual" && saving ? (
                        <View style={[styles.badge, { backgroundColor: `${TEAL}24` }]}>
                          <Text style={[styles.badgeText, { color: TEAL, fontFamily: f.semibold }]}>{t("paywall.save", { percent: saving })}</Text>
                        </View>
                      ) : null}
                    </View>
                    {detail ? <Text style={[styles.optionDetail, { color: c.textMuted, fontFamily: f.regular }]}>{detail}</Text> : null}
                  </View>
                  <Text style={[styles.price, { color: c.text, fontFamily: f.semibold }]}>{item.product.priceString}</Text>
                </PressableScale>
              );
            })}
          </View>
        )}

        {tier === "pro" ? (
          <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("paywall.proPrivacy")}</Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <AuraButton label={ctaLabel} onPress={() => void handleBuy()} loading={busy === "buy"} disabled={owned || !pkg || busy !== null} />
        {trialDays && !owned && pkg ? (
          <Text style={[styles.fine, { color: c.textMuted, fontFamily: f.regular }]}>
            {t("paywall.trialThen", { count: trialDays, price: pkg.product.priceString })}
          </Text>
        ) : null}
        <View style={styles.links}>
          {plan.billingAvailable ? (
            <>
              <PressableScale onPress={() => void handleRestore()} disabled={busy !== null} accessibilityRole="button">
                <Text style={[styles.link, { color: c.textSoft, fontFamily: f.medium }]}>
                  {busy === "restore" ? t("paywall.restoring") : t("paywall.restore")}
                </Text>
              </PressableScale>
              <Text style={[styles.link, { color: c.textMuted }]}>·</Text>
            </>
          ) : null}
          <PressableScale onPress={() => openLegalPage(LEGAL_URLS.privacy)} accessibilityRole="link">
            <Text style={[styles.link, { color: c.textSoft, fontFamily: f.medium }]}>{t("settings.privacyPolicy")}</Text>
          </PressableScale>
          {Platform.OS === "ios" ? (
            <>
              <Text style={[styles.link, { color: c.textMuted }]}>·</Text>
              <PressableScale onPress={() => openLegalPage(LEGAL_URLS.appleEula)} accessibilityRole="link">
                <Text style={[styles.link, { color: c.textSoft, fontFamily: f.medium }]}>{t("paywall.termsOfUse")}</Text>
              </PressableScale>
            </>
          ) : null}
        </View>
        {plan.billingAvailable ? (
          <Text style={[styles.fine, { color: c.textMuted, fontFamily: f.regular }]}>{t(STORE_COPY.renewalTerms)}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  eyebrow: { fontSize: 13.5 },
  title: { fontSize: 30, letterSpacing: -1, lineHeight: 35 },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginTop: 4 },
  lede: { fontSize: 15, lineHeight: 21, marginTop: 10 },
  segmented: { marginTop: 20 },
  card: { marginTop: 14, gap: 10 },
  cardTitle: { fontSize: 17, letterSpacing: -0.2, marginBottom: 2 },
  feature: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  featureText: { flex: 1, fontSize: 14.5, lineHeight: 20 },
  loading: { marginTop: 24 },
  options: { marginTop: 14, gap: 10 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14 },
  optionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  optionTitle: { fontSize: 16 },
  optionDetail: { fontSize: 13, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12 },
  price: { fontSize: 16, fontVariant: ["tabular-nums"] },
  note: { fontSize: 12.5, lineHeight: 18, marginTop: 14 },
  footer: { paddingHorizontal: 20, paddingTop: 10, gap: 8 },
  fine: { fontSize: 11.5, lineHeight: 16, textAlign: "center" },
  links: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 },
  link: { fontSize: 13.5 },
});
