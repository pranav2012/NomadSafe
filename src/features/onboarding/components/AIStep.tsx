import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useLocalization } from "@/localization";
import { Icon, type IconName } from "@/components/nomad/Icon";
import { PermissionRow } from "@/components/nomad/PermissionRow";
import {
  Eyebrow,
  HugeHeadline,
  HeadlineItalic,
} from "@/components/nomad/Typography";
import {
  aiModelService,
  AI_MODELS,
  modelDownloadManager,
  modelNotifications,
  useModelDownload,
  type AiModel,
  type DeviceCapability,
} from "@/features/ai";

interface Props {
  theme: NomadTheme;
  totalSteps: number;
  onModelReady?: (ready: boolean) => void;
}

const questionKeys = [
  { q: "onboarding.forecastHanoi", a: "onboarding.forecastHanoiAnswer" },
  { q: "onboarding.splitLisbon", a: "onboarding.splitLisbonAnswer" },
  { q: "onboarding.transitCdg", a: "onboarding.transitCdgAnswer" },
  { q: "onboarding.monthlyFood", a: "onboarding.monthlyFoodAnswer" },
];

const capabilities: { i: IconName; titleKey: string; subKey: string; colorKey: keyof NomadTheme }[] = [
  { i: "trendUp", titleKey: "onboarding.weeklyBriefs", subKey: "onboarding.weeklyBriefsSub", colorKey: "teal" },
  { i: "sparkle", titleKey: "onboarding.askAnything", subKey: "onboarding.askAnythingSub", colorKey: "mustard" },
  { i: "shield", titleKey: "onboarding.zeroTelemetry", subKey: "onboarding.zeroTelemetrySub", colorKey: "stamp" },
];

function ConicCore({ teal, mustard, stamp, sky }: { teal: string; mustard: string; stamp: string; sky: string }) {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(
      withTiming(360, { duration: 9000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [spin]);
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));

  return (
    <Animated.View style={[{ width: 78, height: 78 }, aStyle]}>
      <Svg width={78} height={78} viewBox="0 0 78 78">
        <Path d="M39,39 L39,0 A39,39 0 0,1 78,39 Z" fill={teal} />
        <Path d="M39,39 L78,39 A39,39 0 0,1 39,78 Z" fill={mustard} />
        <Path d="M39,39 L39,78 A39,39 0 0,1 0,39 Z" fill={stamp} />
        <Path d="M39,39 L0,39 A39,39 0 0,1 39,0 Z" fill={sky} />
      </Svg>
    </Animated.View>
  );
}

function PulseRing({ index, color }: { index: number; color: string }) {
  const scale = useSharedValue(0.7);
  const opacity = useSharedValue(0);
  useEffect(() => {
    const run = () => {
      scale.value = 0.7;
      opacity.value = 0.7;
      scale.value = withDelay(
        index * 700,
        withRepeat(withTiming(1.4, { duration: 2600, easing: Easing.out(Easing.ease) }), -1, false),
      );
      opacity.value = withDelay(
        index * 700,
        withRepeat(withTiming(0, { duration: 2600, easing: Easing.out(Easing.ease) }), -1, false),
      );
    };
    run();
  }, [scale, opacity, index]);

  const size = 90 + index * 18;
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          width: size,
          height: size,
          left: -size / 2,
          top: -size / 2,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: color,
        },
        aStyle,
      ]}
    />
  );
}

function formatSizeMb(sizeMb: number): string {
  if (sizeMb >= 1024) return `${(sizeMb / 1024).toFixed(1)} GB`;
  return `${sizeMb} MB`;
}

export function AIStep({ theme, totalSteps, onModelReady }: Props) {
  const { t } = useLocalization();
  const [qIdx, setQIdx] = useState(0);
  const [capability, setCapability] = useState<DeviceCapability | null>(null);
  const [checking, setChecking] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [downloadedModelId, setDownloadedModelId] = useState<string | null>(null);
  const [notifyEnabled, setNotifyEnabled] = useState(() => modelNotifications.isEnabled());

  const toggleNotify = async () => {
    const next = await modelNotifications.setEnabled(!notifyEnabled);
    setNotifyEnabled(next);
  };

  const download = useModelDownload();
  const downloadingModelId =
    download.status === "downloading" || download.status === "paused"
      ? download.modelId
      : null;
  const downloadProgress = download.progress;
  const downloadPaused = download.status === "paused";
  const downloadError = download.status === "error" ? download.error : null;
  // A just-finished background download counts as downloaded without needing
  // to write back into local state from an effect.
  const effectiveDownloadedId =
    download.status === "completed" && download.modelId
      ? download.modelId
      : downloadedModelId;

  useEffect(() => {
    const timer = setInterval(() => setQIdx((i) => (i + 1) % questionKeys.length), 2600);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const cap = await aiModelService.checkDeviceCapability();
      if (!mounted) return;
      setCapability(cap);
      setChecking(false);

      const selected = aiModelService.getSelectedModelId();
      const downloaded = aiModelService.getDownloadedModelId();
      setSelectedModelId(selected ?? cap.assignedCategory);
      setDownloadedModelId(downloaded);

      // Auto-select the tier-matched model if nothing was previously chosen.
      if (!selected) {
        aiModelService.setSelectedModelId(cap.assignedCategory);
      }

      onModelReady?.(downloaded !== null || !cap.supported);
    };
    run();
    return () => {
      mounted = false;
    };
  }, [onModelReady]);

  useEffect(() => {
    if (!capability) return;
    // Once a download is under way the user can move on — it finishes in the
    // background and notifies on completion.
    const ready =
      !capability.supported ||
      effectiveDownloadedId !== null ||
      download.status === "downloading" ||
      download.status === "paused";
    onModelReady?.(ready);
  }, [capability, effectiveDownloadedId, download.status, onModelReady]);

  const current = questionKeys[qIdx];

  const cloudPulse = useSharedValue(1);
  useEffect(() => {
    cloudPulse.value = withRepeat(
      withSequence(
        withTiming(0.55, { duration: 900 }),
        withTiming(1, { duration: 900 }),
      ),
      -1,
      false,
    );
  }, [cloudPulse]);
  const cloudPulseStyle = useAnimatedStyle(() => ({ opacity: cloudPulse.value }));

  const availableModels = capability ? aiModelService.getAvailableModels(capability) : [];
  const isModelAvailable = (model: AiModel) => availableModels.some((m) => m.id === model.id);

  const selectModel = async (model: AiModel) => {
    setSelectedModelId(model.id);
    aiModelService.setSelectedModelId(model.id);

    // If this model is already on disk, continue without re-downloading.
    if (downloadedModelId === model.id || (await aiModelService.isModelDownloaded(model))) {
      setDownloadedModelId(model.id);
      aiModelService.setDownloadedModelId(model.id);
      onModelReady?.(true);
      return;
    }

    Alert.alert(
      t("onboarding.downloadModelTitle"),
      t("onboarding.downloadModelBody", {
        model: model.name,
        size: formatSizeMb(model.sizeMb),
        ram: model.recommendedRamGb,
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.continue"),
          onPress: () => modelDownloadManager.start(model),
        },
      ],
    );
  };

  const renderCapabilityStatus = () => {
    if (checking || !capability) {
      return (
        <View style={[styles.statusRow, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
          <ActivityIndicator size="small" color={theme.inkSoft} />
          <Text style={[styles.statusText, { color: theme.inkSoft }]}>{t("onboarding.checkingDevice")}</Text>
        </View>
      );
    }

    if (!capability.supported) {
      const titleKey = capability.reason === "lowRam" ? "onboarding.deviceUnsupported" : "onboarding.deviceLimited";
      const subKey = capability.reason === "lowRam" ? "onboarding.unsupportedAiSub" : "onboarding.limitedAiSub";
      return (
        <View style={[styles.statusRow, { backgroundColor: theme.stamp + "16", borderColor: theme.stamp }]}>
          <Icon name="alertTriangle" size={18} color={theme.stamp} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusTitle, { color: theme.inkDeep }]}>{t(titleKey)} · {t("onboarding.deviceRam", { ram: capability.totalMemoryGb })}</Text>
            <Text style={[styles.statusSub, { color: theme.inkSoft }]}>{t(subKey)}</Text>
          </View>
        </View>
      );
    }

    const assigned = AI_MODELS.find((m) => m.id === capability.assignedCategory);
    return (
      <View style={[styles.statusRow, { backgroundColor: theme.tealSoft, borderColor: theme.teal }]}>
        <Icon name="check" size={18} color={theme.teal} strokeWidth={2} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusTitle, { color: theme.inkDeep }]}>
            {t("onboarding.deviceSupported")} · {t("onboarding.deviceRam", { ram: capability.totalMemoryGb })}
          </Text>
          <Text style={[styles.statusSub, { color: theme.inkSoft }]}>
            {assigned
              ? t("onboarding.modelAssigned", { model: assigned.name, quant: assigned.quantLabel })
              : t("onboarding.selectModel")}
          </Text>
        </View>
      </View>
    );
  };

  const renderModelList = () => {
    if (checking || !capability?.supported) return null;

    const sectionTitle = capability.limited
      ? t("onboarding.modelAssignedTitle")
      : t("onboarding.selectModel");

    return (
      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 8 }}>
        <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{sectionTitle}</Text>
        {AI_MODELS.map((model) => {
          const isAssigned = capability?.assignedCategory === model.id;
          const isAvailable = isModelAvailable(model);
          const isSelected = selectedModelId === model.id;
          const isDownloaded = effectiveDownloadedId === model.id;
          const isDownloading = downloadingModelId === model.id;
          const fColor = isAvailable ? theme.teal : theme.inkMuted;
          return (
            <Pressable
              key={model.id}
              disabled={!isAvailable || downloadingModelId !== null}
              onPress={() => selectModel(model)}
              style={({ pressed }) => [
                styles.modelRow,
                {
                  backgroundColor: isSelected ? theme.tealSoft : theme.paperSoft,
                  borderColor: isSelected ? theme.teal : theme.hairline,
                  opacity: !isAvailable ? 0.55 : pressed ? 0.9 : 1,
                },
              ]}
            >
              <View style={[styles.modelIcon, { backgroundColor: fColor + "22" }]}>
                <Icon name="sparkle" size={16} color={fColor} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.modelName, { color: theme.inkDeep }]}>{model.name}</Text>
                  {isAssigned && (
                    <View style={[styles.badge, { backgroundColor: theme.mustard }]}>
                      <Text style={[styles.badgeText, { color: theme.inkDeep }]}>{t("onboarding.modelRecommended")}</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.modelSub, { color: theme.inkSoft }]}>
                  {isDownloading
                    ? downloadPaused
                      ? t("onboarding.modelPaused", { progress: downloadProgress })
                      : t("onboarding.modelDownloading", { progress: downloadProgress })
                    : isDownloaded
                      ? t("onboarding.modelDownloaded")
                      : t(model.descriptionKey)}
                </Text>
                <Text style={[styles.modelRequirement, { color: theme.inkMuted }]}>
                  {t("onboarding.modelRequiredRam", { ram: model.recommendedRamGb })} · {formatSizeMb(model.sizeMb)} · {model.quantLabel}
                </Text>
                {isDownloaded && isSelected && (
                  <Text style={[styles.modelNote, { color: theme.inkMuted }]}>
                    {t("onboarding.modelWillLoad")}
                  </Text>
                )}
              </View>
              {!isAvailable ? (
                <Icon name="alertTriangle" size={16} color={theme.stamp} strokeWidth={2} />
              ) : isDownloaded ? (
                <Icon name="check" size={16} color={theme.teal} strokeWidth={2.4} />
              ) : isDownloading ? (
                downloadPaused ? (
                  <Icon name="pause" size={16} color={theme.mustard} strokeWidth={2} />
                ) : (
                  <ActivityIndicator size="small" color={theme.teal} />
                )
              ) : (
                <Icon name="chevronRight" size={16} color={theme.inkMuted} strokeWidth={2} />
              )}
            </Pressable>
          );
        })}
        {downloadingModelId !== null && (
          <View style={[styles.dlControls, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
            <View style={[styles.dlTrack, { backgroundColor: theme.hairline }]}>
              <View
                style={[
                  styles.dlFill,
                  { width: `${downloadProgress}%`, backgroundColor: downloadPaused ? theme.mustard : theme.teal },
                ]}
              />
            </View>
            <View style={styles.dlButtons}>
              <Pressable
                onPress={() =>
                  downloadPaused ? modelDownloadManager.resume() : modelDownloadManager.pause()
                }
                style={[styles.dlBtn, { borderColor: theme.hairline }]}
              >
                <Icon
                  name={downloadPaused ? "play" : "pause"}
                  size={13}
                  color={theme.inkDeep}
                  strokeWidth={2}
                />
                <Text style={[styles.dlBtnText, { color: theme.inkDeep }]}>
                  {downloadPaused ? t("onboarding.resumeDownload") : t("onboarding.pauseDownload")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => modelDownloadManager.cancel()}
                style={[styles.dlBtn, { borderColor: theme.stamp }]}
              >
                <Icon name="x" size={13} color={theme.stamp} strokeWidth={2} />
                <Text style={[styles.dlBtnText, { color: theme.stamp }]}>
                  {t("common.cancel")}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.dlHint, { color: theme.inkMuted }]}>
              {t("onboarding.downloadBackgroundHint")}
            </Text>
          </View>
        )}
        {downloadError ? (
          <View style={[styles.errorRow, { backgroundColor: theme.stamp + "16", borderColor: theme.stamp }]}>
            <Icon name="alertTriangle" size={16} color={theme.stamp} strokeWidth={2} />
            <Text style={[styles.errorText, { color: theme.stamp }]}>{downloadError}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {/* HERO */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <View style={styles.hero}>
          <LinearGradient
            colors={["#14110E", "#1F2B28", "#0E1A17"]}
            locations={[0, 0.6, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* faint grid */}
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 358 280"
            preserveAspectRatio="none"
            style={[StyleSheet.absoluteFill, { opacity: 0.08 }]}
          >
            {Array.from({ length: 14 }).map((_, i) => (
              <Line
                key={`h${i}`}
                x1="0"
                x2="358"
                y1={i * 22}
                y2={i * 22}
                stroke="#fff"
                strokeWidth="0.4"
              />
            ))}
            {Array.from({ length: 18 }).map((_, i) => (
              <Line
                key={`v${i}`}
                x1={i * 22}
                x2={i * 22}
                y1="0"
                y2="280"
                stroke="#fff"
                strokeWidth="0.3"
              />
            ))}
          </Svg>

          {/* NO CLOUD badge */}
          <View style={[styles.noCloud, { borderColor: "rgba(217,164,65,0.25)" }]}>
            <Animated.View
              style={[
                { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.mustard },
                cloudPulseStyle,
              ]}
            />
            <Text style={[styles.noCloudText, { color: theme.mustard }]}>
              {t("onboarding.noCloud")}
            </Text>
          </View>

          {/* Secure Enclave chip badge */}
          <View style={[styles.enclave, { borderColor: "rgba(255,255,255,0.12)" }]}>
            <Icon name="lock" size={9} color="rgba(255,255,255,0.85)" />
            <Text style={styles.enclaveText}>{t("onboarding.secureEnclave")}</Text>
          </View>

          {/* Phone silhouette */}
          <View style={styles.phoneSilhouette}>
            <LinearGradient
              colors={["rgba(255,255,255,0.06)", "rgba(255,255,255,0.02)"]}
              style={[StyleSheet.absoluteFill, { borderRadius: 26 }]}
            />
            <View style={styles.dynamicIsland} />

            <View style={styles.core}>
              <ConicCore
                teal={theme.teal}
                mustard={theme.mustard}
                stamp={theme.stamp}
                sky={theme.sky}
              />
              <View style={styles.coreInner}>
                <Icon name="sparkle" size={18} color={theme.mustard} strokeWidth={1.8} />
              </View>
              <PulseRing index={0} color={theme.mustard} />
              <PulseRing index={1} color={theme.mustard} />
              <PulseRing index={2} color={theme.mustard} />
            </View>
          </View>

          {/* Question pill */}
          <Animated.View
            key={`q-${qIdx}`}
            entering={FadeIn.duration(400)}
            style={[
              styles.qPill,
              { borderColor: "rgba(255,255,255,0.14)" },
            ]}
          >
            <Text style={[styles.qLabel, { color: theme.mustard }]}>{t("onboarding.you")}</Text>
            <Text style={[styles.qText, { color: "rgba(255,255,255,0.9)" }]}>
              {t(current.q)}
            </Text>
          </Animated.View>

          {/* Answer pill */}
          <Animated.View
            key={`a-${qIdx}`}
            entering={FadeInDown.delay(200).duration(400)}
            style={[
              styles.aPill,
              { backgroundColor: theme.mustard },
            ]}
          >
            <Text style={[styles.aLabel, { color: theme.stamp }]}>
              {t("onboarding.onDevice")}
            </Text>
            <Text style={[styles.aText, { color: theme.inkDeep }]}>
              {t(current.a)}
            </Text>
          </Animated.View>

          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 358 280"
            preserveAspectRatio="none"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          >
            <Path
              d="M132,116 Q170,140 156,154"
              fill="none"
              stroke={theme.mustard}
              strokeWidth="1"
              strokeDasharray="2 3"
              opacity="0.55"
            />
            <Path
              d="M200,156 Q226,178 226,192"
              fill="none"
              stroke={theme.mustard}
              strokeWidth="1"
              strokeDasharray="2 3"
              opacity="0.55"
            />
          </Svg>

          {/* Bottom row: chip + data-out meter */}
          <View style={styles.bottomRow}>
            <View style={[styles.chipMotif, { borderColor: "rgba(255,255,255,0.1)" }]}>
              <Svg width={20} height={20} viewBox="0 0 20 20">
                <Rect
                  x="4"
                  y="4"
                  width="12"
                  height="12"
                  rx="2"
                  fill="none"
                  stroke={theme.teal}
                  strokeWidth="1.2"
                />
                <Rect
                  x="7"
                  y="7"
                  width="6"
                  height="6"
                  rx="1"
                  fill={theme.teal}
                  opacity="0.4"
                />
                {[0, 1, 2, 3].map((i) => (
                  <Line
                    key={`t${i}`}
                    x1={5.5 + i * 3}
                    y1="0"
                    x2={5.5 + i * 3}
                    y2="4"
                    stroke={theme.teal}
                    strokeWidth="1"
                  />
                ))}
                {[0, 1, 2, 3].map((i) => (
                  <Line
                    key={`b${i}`}
                    x1={5.5 + i * 3}
                    y1="16"
                    x2={5.5 + i * 3}
                    y2="20"
                    stroke={theme.teal}
                    strokeWidth="1"
                  />
                ))}
                {[0, 1, 2, 3].map((i) => (
                  <Line
                    key={`l${i}`}
                    x1="0"
                    y1={5.5 + i * 3}
                    x2="4"
                    y2={5.5 + i * 3}
                    stroke={theme.teal}
                    strokeWidth="1"
                  />
                ))}
                {[0, 1, 2, 3].map((i) => (
                  <Line
                    key={`r${i}`}
                    x1="16"
                    y1={5.5 + i * 3}
                    x2="20"
                    y2={5.5 + i * 3}
                    stroke={theme.teal}
                    strokeWidth="1"
                  />
                ))}
              </Svg>
              <View style={{ marginLeft: 8 }}>
                <Text style={styles.chipTitle}>{t("onboarding.neuralEngine")}</Text>
                <Text style={styles.chipSub}>{t("onboarding.modelSize")}</Text>
              </View>
            </View>

            <View style={[styles.outMeter, { borderColor: "rgba(198,67,42,0.28)" }]}>
              <Icon name="wifi" size={10} color="#F4B2A1" />
              <Text style={styles.outMeterText}>{t("onboarding.outZero")}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Headline */}
      <View style={{ paddingHorizontal: 26, paddingTop: 22 }}>
        <Eyebrow color={theme.sky}>
          {t("onboarding.stepOf", { step: 3, total: totalSteps })}
        </Eyebrow>
        <HugeHeadline color={theme.inkDeep}>
          {t("onboarding.aiHeadlinePrefix")}{" "}
          <HeadlineItalic>{t("onboarding.aiHeadlineAccent")}</HeadlineItalic>.
        </HugeHeadline>
        <Text style={[styles.lede, { color: theme.inkSoft }]}>
          {t("onboarding.aiLede")}
        </Text>
      </View>

      {/* Device capability status */}
      <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
        {renderCapabilityStatus()}
      </View>

      {/* Model list */}
      {renderModelList()}

      {/* Notify-when-ready toggle */}
      {!checking && capability?.supported && (
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          <PermissionRow
            theme={theme}
            title={t("onboarding.notifyWhenReady")}
            sub={t("onboarding.notifyWhenReadySub")}
            on={notifyEnabled}
            onPress={toggleNotify}
          />
        </View>
      )}

      {/* What it can do — compact tiles, visually distinct from model rows */}
      <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
        <Text style={[styles.capabilitiesLabel, { color: theme.inkMuted }]}>
          {t("onboarding.aiCapabilities")}
        </Text>
        <View style={styles.capGrid}>
          {capabilities.map((f, i) => {
            const fColor = theme[f.colorKey] as string;
            return (
              <View
                key={i}
                style={[
                  styles.capTile,
                  { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
                ]}
              >
                <View style={[styles.capTileIcon, { backgroundColor: fColor + "22" }]}>
                  <Icon name={f.i} size={15} color={fColor} strokeWidth={2} />
                </View>
                <Text
                  style={[styles.capTileTitle, { color: theme.inkDeep }]}
                  numberOfLines={2}
                >
                  {t(f.titleKey)}
                </Text>
                <Text
                  style={[styles.capTileSub, { color: theme.inkSoft }]}
                  numberOfLines={3}
                >
                  {t(f.subKey)}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Download estimator */}
      <View
        style={{
          paddingHorizontal: 26,
          paddingTop: 14,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text style={[styles.estText, { color: theme.inkMuted }]}>
          {t("onboarding.downloadEstimate")}
        </Text>
        <Text style={[styles.estText, { color: theme.inkMuted }]}>
          {t("onboarding.skipCloudLater")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 280,
    borderRadius: 22,
    position: "relative",
    overflow: "hidden",
  },
  noCloud: {
    position: "absolute",
    top: 14,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(217,164,65,0.14)",
    borderWidth: 1,
  },
  noCloudText: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 1.4,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  enclave: {
    position: "absolute",
    top: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
  },
  enclaveText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 9.5,
    fontFamily: NOMAD_FONTS.mono,
    letterSpacing: 1,
  },
  phoneSilhouette: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -58,
    marginTop: -96,
    width: 116,
    height: 192,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 60,
    shadowOffset: { width: 0, height: 20 },
    elevation: 12,
  },
  dynamicIsland: {
    position: "absolute",
    top: 8,
    left: "50%",
    marginLeft: -21,
    width: 42,
    height: 12,
    borderRadius: 999,
    backgroundColor: "#000",
  },
  core: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -39,
    marginTop: -39,
    width: 78,
    height: 78,
    alignItems: "center",
    justifyContent: "center",
  },
  coreInner: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  qPill: {
    position: "absolute",
    left: 14,
    top: 98,
    maxWidth: 118,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
  },
  qLabel: {
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 3,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  qText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    fontFamily: NOMAD_FONTS.uiMedium,
  },
  aPill: {
    position: "absolute",
    right: 14,
    bottom: 82,
    maxWidth: 128,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 12,
    shadowColor: "#D9A441",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  aLabel: {
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 3,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  aText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  bottomRow: {
    position: "absolute",
    bottom: 14,
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  chipMotif: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
  },
  chipTitle: {
    fontSize: 9,
    fontWeight: "700",
    color: "rgba(255,255,255,0.9)",
    letterSpacing: 0.6,
    fontFamily: NOMAD_FONTS.mono,
  },
  chipSub: {
    fontSize: 8.5,
    color: "rgba(255,255,255,0.5)",
    fontFamily: NOMAD_FONTS.mono,
    marginTop: 1,
  },
  outMeter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(198,67,42,0.15)",
    borderWidth: 1,
  },
  outMeterText: {
    color: "#F4B2A1",
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    fontWeight: "600",
  },
  lede: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 14 * 1.55,
    fontFamily: NOMAD_FONTS.ui,
  },
  compCell: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    position: "relative",
    minHeight: 86,
  },
  compEyebrow: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 4,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  compTitle: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  compTitleDark: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  compSub: {
    fontSize: 10.5,
    marginTop: 3,
    lineHeight: 14,
    fontFamily: NOMAD_FONTS.ui,
  },
  compBar: {
    marginTop: 8,
    height: 4,
    borderRadius: 2,
    position: "relative",
    overflow: "hidden",
  },
  compBarFill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    borderRadius: 2,
  },
  compDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  capabilitiesLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
    paddingLeft: 2,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  capGrid: {
    flexDirection: "row",
    gap: 8,
  },
  capTile: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  capTileIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  capTileTitle: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  capTileSub: {
    fontSize: 10,
    marginTop: 3,
    lineHeight: 13,
    fontFamily: NOMAD_FONTS.ui,
  },
  dlControls: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  dlTrack: {
    height: 5,
    borderRadius: 999,
    overflow: "hidden",
  },
  dlFill: {
    height: "100%",
    borderRadius: 999,
  },
  dlButtons: {
    flexDirection: "row",
    gap: 8,
  },
  dlBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  dlBtnText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  dlHint: {
    fontSize: 10.5,
    textAlign: "center",
    fontFamily: NOMAD_FONTS.ui,
  },
  estText: {
    fontSize: 11,
    fontFamily: NOMAD_FONTS.mono,
    letterSpacing: 0.3,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 13,
    fontFamily: NOMAD_FONTS.ui,
  },
  statusTitle: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  statusSub: {
    fontSize: 11,
    marginTop: 1,
    fontFamily: NOMAD_FONTS.ui,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  modelIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modelName: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  modelSub: {
    fontSize: 11,
    marginTop: 1,
    fontFamily: NOMAD_FONTS.ui,
  },
  modelRequirement: {
    fontSize: 10,
    marginTop: 2,
    fontFamily: NOMAD_FONTS.mono,
    letterSpacing: 0.2,
  },
  badge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 0.4,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  modelNote: {
    fontSize: 10,
    marginTop: 4,
    fontFamily: NOMAD_FONTS.ui,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 12,
    fontFamily: NOMAD_FONTS.ui,
  },
});
