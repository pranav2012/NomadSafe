import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
import { Icon } from "@/components/nomad/Icon";
import { NomadCard } from "@/components/nomad/Card";
import { NomadButton } from "@/components/nomad/Button";
import { useAiModels, type ModelListItem } from "../hooks/useAiModels";

interface Props {
  theme: NomadTheme;
  onEnableAi?: () => void;
}

function StatusBadge({
  text,
  color,
  bg,
  icon,
}: {
  text: string;
  color: string;
  bg: string;
  icon?: React.ReactNode;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon}
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

function ModelRow({
  item,
  theme,
  onDownload,
  onSetDefault,
  onDelete,
  t,
  formatSize,
}: {
  item: ModelListItem;
  theme: NomadTheme;
  onDownload: (item: ModelListItem) => void;
  onSetDefault: (item: ModelListItem) => void;
  onDelete: (item: ModelListItem) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatSize: (sizeMb: number) => string;
}) {
  const { model, isDownloaded, isLoaded, isActive, isAvailable, isRecommended } = item;

  const statusText = isLoaded
    ? t("aiTab.modelLoaded")
    : isActive
      ? t("aiTab.modelActive")
      : isDownloaded
        ? t("aiTab.modelDownloaded")
        : isAvailable
          ? t("aiTab.modelReadyToDownload")
          : t("aiTab.modelUnsupported");

  const statusColor = isLoaded ? theme.teal : isActive ? theme.mustard : isDownloaded ? theme.teal : theme.inkMuted;
  const statusBg = isLoaded ? theme.tealSoft : isActive ? theme.mustardSoft : isDownloaded ? theme.tealSoft : theme.paperSoft;

  return (
    <NomadCard theme={theme} style={isActive ? styles.activeCard : undefined}>
      <View style={styles.row}>
        <View
          style={[
            styles.modelIcon,
            { backgroundColor: isAvailable ? theme.teal + "22" : theme.inkMuted + "22" },
          ]}
        >
          <Icon name="cpu" size={18} color={isAvailable ? theme.teal : theme.inkMuted} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={[styles.modelName, { color: theme.inkDeep }]}>{model.name}</Text>
            <StatusBadge text={statusText} color={statusColor} bg={statusBg} />
          </View>
          <Text style={[styles.modelSub, { color: theme.inkSoft }]}>
            {formatSize(model.sizeMb)} · {model.quantLabel} · {t("aiTab.requiresRam", { ram: model.recommendedRamGb })}
          </Text>
          {isRecommended && (
            <Text style={[styles.recommended, { color: theme.mustard }]}>
              {t("aiTab.recommendedForDevice")}
            </Text>
          )}
        </View>
      </View>

      {item.isDownloading || item.isPaused ? (
        <View style={styles.dlWrap}>
          <View style={[styles.dlTrack, { backgroundColor: theme.hairline }]}>
            <View
              style={[
                styles.dlFill,
                {
                  width: `${item.progress}%`,
                  backgroundColor: item.isPaused ? theme.mustard : theme.teal,
                },
              ]}
            />
          </View>
          <Text style={[styles.dlProgress, { color: theme.inkSoft }]}>
            {item.isPaused ? t("aiTab.pausedPercent", { progress: item.progress }) : t("aiTab.downloadingPercent", { progress: item.progress })}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {isDownloaded ? (
          <>
            {!isActive && (
              <NomadButton
                variant="teal"
                theme={theme}
                onPress={() => onSetDefault(item)}
                icon={<Icon name="check" size={15} color="#fff" strokeWidth={2} />}
              >
                {t("aiTab.setAsActive")}
              </NomadButton>
            )}
            {isLoaded && (
              <NomadButton
                variant="ghost"
                theme={theme}
                disabled
                icon={<Icon name="check" size={15} color={theme.inkMuted} strokeWidth={2} />}
              >
                {t("aiTab.loadedInMemory")}
              </NomadButton>
            )}
            <NomadButton
              variant="stamp"
              theme={theme}
              onPress={() => onDelete(item)}
              icon={<Icon name="trash" size={15} color="#fff" strokeWidth={2} />}
            >
              {t("aiTab.deleteModel")}
            </NomadButton>
          </>
        ) : isAvailable ? (
          <NomadButton
            variant="primary"
            theme={theme}
            onPress={() => onDownload(item)}
            icon={<Icon name="download" size={15} color={theme.paperSoft} strokeWidth={2} />}
          >
            {t("aiTab.downloadModel", { size: formatSize(model.sizeMb) })}
          </NomadButton>
        ) : (
          <NomadButton variant="ghost" theme={theme} disabled>
            {t("aiTab.notAvailable")}
          </NomadButton>
        )}
      </View>
    </NomadCard>
  );
}

export function AiModelManager({ theme, onEnableAi }: Props) {
  const { t } = useLocalization();
  const {
    models,
    capability,
    isChecking,
    activeModelId,
    downloadError,
    formatSize,
    setDefaultModel,
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteModel,
  } = useAiModels();

  const anyDownloaded = models.some((m) => m.isDownloaded);

  const handleDownload = async (item: ModelListItem) => {
    await startDownload(item.model);
    onEnableAi?.();
  };

  const handleSetDefault = (item: ModelListItem) => {
    setDefaultModel(item.model);
  };

  const handleDelete = (item: ModelListItem) => {
    Alert.alert(
      t("aiTab.deleteTitle"),
      t("aiTab.deleteBody", { model: item.model.name, size: formatSize(item.model.sizeMb) }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => deleteModel(item.model),
        },
      ],
    );
  };

  if (isChecking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.teal} />
        <Text style={[styles.checking, { color: theme.inkSoft }]}>{t("aiTab.checkingDevice")}</Text>
      </View>
    );
  }

  if (!capability?.supported) {
    return (
      <NomadCard theme={theme} style={styles.unsupportedCard}>
        <View style={styles.iconMarkWrap}>
          <View style={[styles.iconMark, { backgroundColor: theme.stampSoft }]}>
            <Icon name="alertTriangle" size={28} color={theme.stamp} strokeWidth={2} />
          </View>
        </View>
        <Text style={[styles.unsupportedTitle, { color: theme.inkDeep }]}>
          {t("aiTab.unsupportedTitle")}
        </Text>
        <Text style={[styles.unsupportedBody, { color: theme.inkSoft }]}>{t("aiTab.unsupportedBody")}</Text>
      </NomadCard>
    );
  }

  const activeModel = models.find((m) => m.isActive) ?? null;
  const downloading = models.find((m) => m.isDownloading || m.isPaused) ?? null;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      {!anyDownloaded && (
        <NomadCard theme={theme} style={styles.introCard}>
          <View style={styles.iconMarkWrap}>
            <View style={[styles.iconMark, { backgroundColor: theme.tealSoft }]}>
              <Icon name="sparkle" size={28} color={theme.teal} strokeWidth={2} />
            </View>
          </View>
          <Text style={[styles.introTitle, { color: theme.inkDeep }]}>{t("aiTab.introTitle")}</Text>
          <Text style={[styles.introBody, { color: theme.inkSoft }]}>{t("aiTab.introBody")}</Text>
        </NomadCard>
      )}

      {activeModel && (
        <View style={[styles.activeBanner, { backgroundColor: theme.tealSoft, borderColor: theme.teal }]}>
          <Icon name="check" size={16} color={theme.teal} strokeWidth={2.4} />
          <Text style={[styles.activeBannerText, { color: theme.teal }]}>
            {t("aiTab.activeBanner", { model: activeModel.model.name })}
          </Text>
        </View>
      )}

      <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("aiTab.models")}</Text>

      {models.map((item) => (
        <ModelRow
          key={item.model.id}
          item={item}
          theme={theme}
          onDownload={handleDownload}
          onSetDefault={handleSetDefault}
          onDelete={handleDelete}
          t={t}
          formatSize={formatSize}
        />
      ))}

      {downloading && (
        <View style={[styles.dlControls, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
          <Pressable
            onPress={() => (downloading.isPaused ? resumeDownload() : pauseDownload())}
            style={[styles.dlBtn, { borderColor: theme.hairline }]}
          >
            <Icon name={downloading.isPaused ? "play" : "pause"} size={13} color={theme.inkDeep} strokeWidth={2} />
            <Text style={[styles.dlBtnText, { color: theme.inkDeep }]}>
              {downloading.isPaused ? t("aiTab.resume") : t("aiTab.pause")}
            </Text>
          </Pressable>
          <Pressable onPress={() => cancelDownload()} style={[styles.dlBtn, { borderColor: theme.stamp }]}>
            <Icon name="x" size={13} color={theme.stamp} strokeWidth={2} />
            <Text style={[styles.dlBtnText, { color: theme.stamp }]}>{t("common.cancel")}</Text>
          </Pressable>
        </View>
      )}

      {downloadError ? (
        <View style={[styles.errorRow, { backgroundColor: theme.stampSoft, borderColor: theme.stamp }]}>
          <Icon name="alertTriangle" size={16} color={theme.stamp} strokeWidth={2} />
          <Text style={[styles.errorText, { color: theme.stamp }]}>{downloadError}</Text>
        </View>
      ) : null}

      <Text style={[styles.footer, { color: theme.inkMuted }]}>{t("aiTab.privacyFooter")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 120 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  checking: { marginTop: 12, fontSize: 13, fontFamily: NOMAD_FONTS.ui },
  introCard: { alignItems: "center", marginBottom: 18, paddingVertical: 24 },
  iconMarkWrap: { alignItems: "center", marginBottom: 14 },
  iconMark: { width: 60, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  introTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 24,
    textAlign: "center",
    lineHeight: 28,
  },
  introBody: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 8,
  },
  activeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  activeBannerText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 13,
  },
  sectionLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  activeCard: { borderWidth: 2 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  modelIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  modelName: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 16 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999 },
  badgeText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 10, letterSpacing: 0.3 },
  modelSub: { fontFamily: NOMAD_FONTS.ui, fontSize: 12, marginTop: 4 },
  recommended: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 11, marginTop: 4 },
  dlWrap: { marginTop: 14 },
  dlTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  dlFill: { height: "100%", borderRadius: 3 },
  dlProgress: { fontFamily: NOMAD_FONTS.mono, fontSize: 11, marginTop: 6 },
  actions: { flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" },
  dlControls: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
  },
  dlBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  dlBtnText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13 },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  errorText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13, flex: 1 },
  unsupportedCard: { alignItems: "center", paddingVertical: 32, margin: 16 },
  unsupportedTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 22,
    textAlign: "center",
  },
  unsupportedBody: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 10,
  },
  footer: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 10.5,
    textAlign: "center",
    letterSpacing: 0.4,
    marginTop: 18,
  },
});
