import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar as RNStatusBar,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { useSettingsStore } from "@/features/settings";
import { Icon } from "@/components/nomad/Icon";
import { AiModelManager } from "../components/AiModelManager";
import { AiDashboard } from "../components/AiDashboard";
import { AiChat } from "../components/AiChat";
import { useAiModels } from "../hooks/useAiModels";

type Tab = "dashboard" | "chat" | "models";

export default function AiScreen() {
  const { isDark, nomad } = useTheme();
  const { t } = useLocalization();
  const router = useRouter();
  const theme = nomad.colors;
  const localAiEnabled = useSettingsStore((s) => s.localAiEnabled);
  const { activeModelId, models } = useAiModels();
  const [tab, setTab] = useState<Tab>("dashboard");

  const activeModel = models.find((m) => m.isActive) ?? null;
  const anyDownloaded = models.some((m) => m.isDownloaded);

  if (!localAiEnabled) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.paper }} edges={["top", "left", "right"]}>
        <StatusBar style={isDark ? "light" : "dark"} />
        <RNStatusBar barStyle={isDark ? "light-content" : "dark-content"} />

        <View style={styles.header}>
          <View>
            <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>{t("aiTab.onDevice")}</Text>
            <Text style={[styles.title, { color: theme.inkDeep }]}>{t("tabs.ai")}</Text>
          </View>
        </View>

        <View style={styles.disabledWrap}>
          <View style={[styles.disabledIcon, { backgroundColor: theme.paperSoft }]}>
            <Icon name="sparkle" size={28} color={theme.inkMuted} strokeWidth={2} />
          </View>
          <Text style={[styles.disabledTitle, { color: theme.inkDeep }]}>{t("aiTab.disabledTitle")}</Text>
          <Text style={[styles.disabledBody, { color: theme.inkSoft }]}>{t("aiTab.disabledBody")}</Text>
          <Pressable
            onPress={() => router.push("/settings")}
            style={({ pressed }) => [
              styles.disabledButton,
              { backgroundColor: theme.teal, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={[styles.disabledButtonText, { color: theme.inverse }]}>
              {t("aiTab.disabledAction")}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.paper }} edges={["top", "left", "right"]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <RNStatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>
            {t("aiTab.onDevice")}
          </Text>
          <Text style={[styles.title, { color: theme.inkDeep }]}>{t("tabs.ai")}</Text>
        </View>
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: anyDownloaded ? theme.tealSoft : theme.paperSoft,
              borderColor: anyDownloaded ? theme.teal : theme.hairline,
            },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              { backgroundColor: anyDownloaded ? theme.teal : theme.inkMuted },
            ]}
          />
          <Text
            style={[
              styles.statusText,
              { color: anyDownloaded ? theme.teal : theme.inkMuted },
            ]}
          >
            {anyDownloaded ? t("aiTab.offlineReady") : t("aiTab.noModel")}
          </Text>
        </View>
      </View>

      <View style={styles.tabBar}>
        {[
          { id: "dashboard" as Tab, label: t("aiTab.dashboard"), icon: "trendUp" as const },
          { id: "chat" as Tab, label: t("aiTab.chat"), icon: "sparkle" as const },
          { id: "models" as Tab, label: t("aiTab.models"), icon: "cpu" as const },
        ].map((tItem) => {
          const active = tab === tItem.id;
          return (
            <Pressable
              key={tItem.id}
              onPress={() => setTab(tItem.id)}
              style={({ pressed }) => [
                styles.tab,
                {
                  backgroundColor: active ? theme.inkDeep : "transparent",
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <Icon
                name={tItem.icon}
                size={14}
                color={active ? theme.paperSoft : theme.inkSoft}
                strokeWidth={2}
              />
              <Text style={[styles.tabLabel, { color: active ? theme.paperSoft : theme.inkSoft }]}>
                {tItem.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1 }}>
        {tab === "dashboard" ? (
          <AiDashboard theme={theme} />
        ) : tab === "chat" ? (
          <AiChat theme={theme} activeModelName={activeModel?.model.name ?? null} />
        ) : (
          <AiModelManager theme={theme} onEnableAi={() => setTab("dashboard")} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
  },
  eyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 38,
    letterSpacing: -0.5,
    lineHeight: 42,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: 999 },
  statusText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 11, letterSpacing: 0.3 },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "transparent",
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0)",
    gap: 4,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabLabel: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13 },
  disabledWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  disabledIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  disabledTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 24,
    textAlign: "center",
    lineHeight: 28,
  },
  disabledBody: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  disabledButton: {
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  disabledButtonText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 15,
  },
});
