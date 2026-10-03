import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { AuraListGroup, AuraListRow } from "@/components/aura/AuraList";
import { AuraSkyHero } from "@/components/aura/AuraSkyHero";
import { useAura } from "@/components/aura/useAura";
import { auraStatusColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { StepHeader } from "./StepHeader";

const [CALM, TEAL, VIOLET] = auraStatusColors.calm;

/** Intro: the aurora sky hero and the three things the app does. */
export function WelcomeStep() {
  const { c, isDark } = useAura();
  const { t } = useLocalization();
  const { width } = useWindowDimensions();
  const heroHeight = Math.round(width * 0.82);

  return (
    <View>
      <View style={{ height: heroHeight }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View entering={FadeIn.duration(700)}>
          <AuraSkyHero width={width} height={heroHeight} isDark={isDark} />
        </Animated.View>
        <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} style={styles.heroFade} />
      </View>

      <Animated.View entering={FadeInDown.delay(200).duration(420)} style={styles.body}>
        <StepHeader title={t("onboarding.welcomeTitle")} lede={t("onboarding.welcomeBody")} />
        <AuraListGroup style={styles.facts}>
          <AuraListRow icon="shield" tone={CALM} label={t("onboarding.factSafetyTitle")} detail={t("onboarding.factSafetyBody")} />
          <AuraListRow icon="wallet" tone={TEAL} label={t("onboarding.factMoneyTitle")} detail={t("onboarding.factMoneyBody")} />
          <AuraListRow icon="sparkle" tone={VIOLET} label={t("onboarding.factAiTitle")} detail={t("onboarding.factAiBody")} />
        </AuraListGroup>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 72 },
  body: { paddingHorizontal: 20, marginTop: -8 },
  facts: { marginTop: 22 },
});
