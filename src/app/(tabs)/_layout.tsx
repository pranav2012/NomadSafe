import React from "react";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";

export default function TabsLayout() {
  const { isDark, nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();

  return (
    <NativeTabs
      tintColor={theme.stamp}
      iconColor={{ default: theme.inkMuted, selected: theme.stamp }}
      labelStyle={{
        default: {
          color: theme.inkMuted,
          fontFamily: NOMAD_FONTS.uiSemi,
          fontSize: 11,
        },
        selected: {
          color: theme.stamp,
          fontFamily: NOMAD_FONTS.uiSemi,
          fontSize: 11,
        },
      }}
      backgroundColor={isDark ? "rgba(15,21,25,0.94)" : theme.paperSoft}
      blurEffect={isDark ? "systemMaterialDark" : "systemMaterialLight"}
      shadowColor={isDark ? "rgba(240,230,214,0.08)" : theme.hairline}
      indicatorColor={isDark ? "rgba(224,96,68,0.18)" : theme.stampSoft}
      rippleColor={isDark ? "rgba(224,96,68,0.18)" : theme.stampSoft}
      labelVisibilityMode="labeled"
      minimizeBehavior="automatic"
      disableTransparentOnScrollEdge
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t("tabs.trip")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "safari", selected: "safari.fill" }}
          md={{ default: "explore", selected: "explore" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="sos">
        <NativeTabs.Trigger.Label>{t("tabs.safety")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "shield", selected: "shield.fill" }}
          md={{ default: "shield", selected: "shield" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="sharing">
        <NativeTabs.Trigger.Label>{t("tabs.share")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "person.2", selected: "person.2.fill" }}
          md={{ default: "groups", selected: "groups" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="expenses">
        <NativeTabs.Trigger.Label>{t("tabs.money")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "wallet.pass", selected: "wallet.pass.fill" }}
          md={{
            default: "account_balance_wallet",
            selected: "account_balance_wallet",
          }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="ai">
        <NativeTabs.Trigger.Label>{t("tabs.ai")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "sparkles", selected: "sparkles" }}
          md={{ default: "auto_awesome", selected: "auto_awesome" }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
