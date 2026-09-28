import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from "react-native-maps";
import * as Location from "expo-location";
import * as Battery from "expo-battery";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { Icon } from "@/components/nomad/Icon";
import { NomadCard } from "@/components/nomad/Card";
import { NomadButton } from "@/components/nomad/Button";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import {
  emergencyContactsStorage,
  normalizeEmail,
} from "@/features/onboarding/services/emergencyContactsStorage";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSharingStore, getDrainPercentForMode, type BroadcastMode } from "../store/sharingStore";
import {
  BackgroundLocationDeniedError,
  isLocationBroadcastRunning,
  readBroadcastState,
  startLocationBroadcast,
  stopLocationBroadcast,
} from "../services/locationBroadcastTask";
import {
  BackgroundLocationDisclosure,
  hasAcceptedBackgroundDisclosure,
} from "../components/BackgroundLocationDisclosure";
import { heavyImpact, successNotification } from "@/utils/haptics";
import type { LatLng } from "@/features/trips/store/tripsStore";
import { track } from "@/services/analytics";
import { PostHogMaskView } from "posthog-react-native";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.pranav.nomadsafe";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STALE_AFTER_MS = 15 * 60_000;

const MODES: { id: BroadcastMode; labelKey: string; subKey: string; icon: "compass" | "battery" | "shield" }[] = [
  { id: "normal", labelKey: "sharing.modeNormal", subKey: "sharing.modeNormalSub", icon: "compass" },
  { id: "low", labelKey: "sharing.modeLow", subKey: "sharing.modeLowSub", icon: "battery" },
  { id: "emergency", labelKey: "sharing.modeEmergency", subKey: "sharing.modeEmergencySub", icon: "shield" },
];

type OutgoingLink = { id: Id<"contactLinks">; linkedUserId: string; name: string; email: string; status: "pending" | "accepted" | "declined" };
type IncomingLink = { id: Id<"contactLinks">; ownerUserId: string; ownerName: string; ownerEmail: string | null; status: "pending" | "accepted" | "declined" };
type Invite = { id: Id<"pendingInvites">; name: string; email: string | null; phone: string | null };
type IncomingShare = { ownerUserId: string; ownerName: string; latitude: number; longitude: number; battery: number | null; updatedAt: number };

function initialOf(name: string) {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

export default function SharingScreen() {
  const { nomad, isDark } = useTheme();
  const theme = nomad.colors;
  const card = nomad.components.card;
  const { t, formatTime, locale } = useLocalization();

  const isBroadcasting = useSharingStore((s) => s.isBroadcasting);
  const mode = useSharingStore((s) => s.mode);
  const currentBattery = useSharingStore((s) => s.currentBattery);
  const setBroadcasting = useSharingStore((s) => s.setBroadcasting);
  const setMode = useSharingStore((s) => s.setMode);
  const setCurrentBattery = useSharingStore((s) => s.setCurrentBattery);

  const contactLinks = useQuery(api.sharing.getContactLinks) as
    | { outgoing: OutgoingLink[]; incoming: IncomingLink[]; invites: Invite[] }
    | undefined;
  const incomingShares = useQuery(api.sharing.getIncomingShares) as IncomingShare[] | undefined;
  const outgoingShares = useQuery(api.sharing.getOutgoingShares);

  const requestContactLink = useMutation(api.sharing.requestContactLink);
  const respondToContactLink = useMutation(api.sharing.respondToContactLink);
  const removeContactLink = useMutation(api.sharing.removeContactLink);
  const removeInvite = useMutation(api.sharing.removeInvite);
  const setSharePaused = useMutation(api.sharing.setSharePaused);

  const [location, setLocation] = useState<{ latitude: number; longitude: number; city?: string; country?: string } | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [broadcastInfo, setBroadcastInfo] = useState(() => readBroadcastState());
  const [busy, setBusy] = useState(false);
  const [disclosureVisible, setDisclosureVisible] = useState(false);
  const [addVisible, setAddVisible] = useState(false);

  // Re-sync the UI with the real OS task; it may have been stopped externally.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      isLocationBroadcastRunning().then((running) => {
        if (active && running !== useSharingStore.getState().isBroadcasting) setBroadcasting(running);
      });
      setBroadcastInfo(readBroadcastState());
      return () => {
        active = false;
      };
    }, [setBroadcasting]),
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) return;
        const loc =
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null)) ??
          (await Location.getLastKnownPositionAsync().catch(() => null));
        if (!loc || !mounted) return;
        setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        const [reverse] = await Location.reverseGeocodeAsync(loc.coords).catch(() => []);
        if (mounted && reverse) {
          setLocation({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            city: reverse.city ?? reverse.subregion ?? undefined,
            country: reverse.country ?? undefined,
          });
        }
      } catch {}
    })();
    Battery.getBatteryLevelAsync()
      .then((level) => {
        if (mounted && level >= 0) setCurrentBattery(Math.round(level * 100));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [setCurrentBattery]);

  useEffect(() => {
    const id = setInterval(() => {
      setNowTick(Date.now());
      setBroadcastInfo(readBroadcastState());
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  const pausedIds = useMemo(
    () => new Set((outgoingShares ?? []).filter((s) => s.paused).map((s) => s.recipientUserId)),
    [outgoingShares],
  );
  const outgoing = contactLinks?.outgoing ?? [];
  const invites = contactLinks?.invites ?? [];
  const incomingRequests = (contactLinks?.incoming ?? []).filter((l) => l.status === "pending");
  const activeRecipientCount = outgoing.filter((l) => l.status === "accepted" && !pausedIds.has(l.linkedUserId)).length;

  const beginBroadcast = useCallback(async (nextMode: BroadcastMode) => {
    setBusy(true);
    try {
      await startLocationBroadcast(nextMode);
      setBroadcasting(true);
      track("live_share_started", { mode: nextMode, recipients: activeRecipientCount });
      setBroadcastInfo(readBroadcastState());
      heavyImpact();
    } catch (err) {
      setBroadcasting(await isLocationBroadcastRunning());
      const background = err instanceof BackgroundLocationDeniedError;
      Alert.alert(
        t("sharing.permissionTitle"),
        background ? t("sharing.backgroundPermissionBody") : t("sharing.permissionBody"),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("sharing.openSettings"), onPress: () => Linking.openSettings() },
        ],
      );
    } finally {
      setBusy(false);
    }
  }, [activeRecipientCount, setBroadcasting, t]);

  const handleToggleBroadcast = useCallback(async () => {
    if (busy) return;
    if (isBroadcasting) {
      setBusy(true);
      try {
        await stopLocationBroadcast();
        setBroadcasting(false);
        track("live_share_stopped");
        successNotification();
      } catch {
        setBroadcasting(await isLocationBroadcastRunning());
        Alert.alert(t("sharing.stopErrorTitle"), t("sharing.stopErrorBody"));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!hasAcceptedBackgroundDisclosure()) {
      setDisclosureVisible(true);
      return;
    }
    await beginBroadcast(mode);
  }, [beginBroadcast, busy, isBroadcasting, mode, setBroadcasting, t]);

  const handleModeChange = useCallback(async (next: BroadcastMode) => {
    if (next === mode || busy) return;
    setMode(next);
    if (isBroadcasting) await beginBroadcast(next);
  }, [beginBroadcast, busy, isBroadcasting, mode, setMode]);

  const handleTogglePause = useCallback(async (link: OutgoingLink) => {
    try {
      await setSharePaused({ recipientUserId: link.linkedUserId, paused: !pausedIds.has(link.linkedUserId) });
    } catch {
      Alert.alert(t("sharing.linkErrorTitle"), t("sharing.linkErrorBody"));
    }
  }, [pausedIds, setSharePaused, t]);

  const handleRespond = useCallback(async (linkId: Id<"contactLinks">, accept: boolean) => {
    try {
      await respondToContactLink({ linkId, accept });
    } catch {
      Alert.alert(t("sharing.linkErrorTitle"), t("sharing.linkErrorBody"));
    }
  }, [respondToContactLink, t]);

  const confirmRemoveLink = useCallback((linkId: Id<"contactLinks">, name: string) => {
    Alert.alert(t("sharing.removeTitle", { name }), t("sharing.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("sharing.remove"),
        style: "destructive",
        onPress: () => {
          removeContactLink({ linkId }).catch(() =>
            Alert.alert(t("sharing.linkErrorTitle"), t("sharing.linkErrorBody")),
          );
        },
      },
    ]);
  }, [removeContactLink, t]);

  const sendInvite = useCallback((invite: { name: string; phone?: string | null; email?: string | null }) => {
    const body = t("sharing.inviteMessage", { url: PLAY_STORE_URL });
    if (invite.phone) {
      Linking.openURL(`sms:${invite.phone}?body=${encodeURIComponent(body)}`).catch(() => Share.share({ message: body }));
    } else if (invite.email) {
      Linking.openURL(
        `mailto:${invite.email}?subject=${encodeURIComponent(t("sharing.inviteSubject"))}&body=${encodeURIComponent(body)}`,
      ).catch(() => Share.share({ message: body }));
    } else {
      Share.share({ message: body }).catch(() => {});
    }
  }, [t]);

  const handleAddPerson = useCallback(async (input: { name: string; email: string; phone?: string }) => {
    const res = await requestContactLink({ name: input.name, email: input.email, phone: input.phone });
    if (res.status === "invite_pending") {
      Alert.alert(t("sharing.notOnAppTitle", { name: input.name }), t("sharing.notOnAppBody"), [
        { text: t("common.later"), style: "cancel" },
        { text: t("sharing.sendInvite"), onPress: () => sendInvite({ name: input.name, email: input.email, phone: input.phone }) },
      ]);
    }
  }, [requestContactLink, sendInvite, t]);

  const handlePing = useCallback((phone: string | null | undefined) => {
    if (!phone) {
      Alert.alert(t("sharing.noPhoneTitle"), t("sharing.noPhoneBody"));
      return;
    }
    const body = location
      ? t("sharing.pingWithLocation", { url: `https://maps.google.com/?q=${location.latitude},${location.longitude}` })
      : t("sharing.pingNoLocation");
    Linking.openURL(`sms:${phone}?body=${encodeURIComponent(body)}`).catch(() => {});
  }, [location, t]);

  const contactPhoneByEmail = useMemo(() => {
    const map = new Map<string, string>();
    emergencyContactsStorage.get().forEach((c) => {
      if (c.email && c.phone) map.set(normalizeEmail(c.email), c.phone);
    });
    return map;
  }, []);

  const lastPublishedAt = broadcastInfo.lastPublishedAt;
  const lastUpdateText = lastPublishedAt ? formatAgo(nowTick - lastPublishedAt, t) : t("sharing.neverUpdated");
  const drain = getDrainPercentForMode(mode);
  const remainingHours = currentBattery != null ? Math.max(0, Math.round(currentBattery / drain)) : null;

  const locationLabel =
    location?.city && location?.country
      ? `${location.city}, ${location.country}`
      : t("sharing.fallbackLocation");

  const userPoint: LatLng | null = useMemo(
    () => (location ? { latitude: location.latitude, longitude: location.longitude } : null),
    [location],
  );

  const liveShares = useMemo(
    () => (incomingShares ?? []).filter((s) => !(s.latitude === 0 && s.longitude === 0)),
    [incomingShares],
  );

  const allMapPoints: LatLng[] = useMemo(() => {
    const points: LatLng[] = [];
    if (userPoint) points.push(userPoint);
    liveShares.forEach((s) => points.push({ latitude: s.latitude, longitude: s.longitude }));
    return points;
  }, [userPoint, liveShares]);

  const initialRegion: Region | null = useMemo(() => {
    if (allMapPoints.length === 0) return null;
    const lats = allMapPoints.map((p) => p.latitude);
    const lons = allMapPoints.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: Math.max(0.04, (maxLat - minLat) * 1.6 + 0.02),
      longitudeDelta: Math.max(0.04, (maxLon - minLon) * 1.6 + 0.02),
    };
  }, [allMapPoints]);

  const mapRef = useRef<MapView>(null);
  useEffect(() => {
    if (allMapPoints.length < 2 || !mapRef.current) return;
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(allMapPoints, {
        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
        animated: true,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [allMapPoints]);

  const formatKm = (km: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: "unit", unit: "kilometer", maximumFractionDigits: km < 10 ? 1 : 0 }).format(km);
    } catch {
      return `${km.toFixed(km < 10 ? 1 : 0)} km`;
    }
  };

  const colorFor = (index: number) => [theme.teal, theme.mustard, theme.sky, theme.stamp][index % 4];

  return (
    <View style={{ flex: 1, backgroundColor: theme.paper }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.screenHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.screenSubtitle, { color: theme.inkMuted }]}>{t("sharing.eyebrow")}</Text>
              <Text style={[styles.screenTitle, { color: theme.inkDeep }]} accessibilityRole="header">{t("sharing.title")}</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: isBroadcasting ? theme.tealSoft : theme.hairline }]}>
              <View style={[styles.pillDot, { backgroundColor: isBroadcasting ? theme.teal : theme.inkMuted }]} />
              <Text style={[styles.pillText, { color: isBroadcasting ? theme.teal : theme.inkMuted }]}>
                {isBroadcasting ? t("sharing.liveStatus", { count: activeRecipientCount }) : t("sharing.offlineStatus")}
              </Text>
            </View>
          </View>

          <NomadCard theme={theme} padding={0} style={{ overflow: "hidden", borderColor: "transparent" }}>
            <LinearGradient colors={[theme.sky, theme.teal]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.heroGradient, { borderRadius: card.borderRadius }]}>
              <View style={StyleSheet.absoluteFill}>
                <View style={{ position: "absolute", right: -30, bottom: -30, opacity: 0.14 }}>
                  <Icon name="users" size={160} color="#fff" strokeWidth={0.8} />
                </View>
              </View>
              <View style={styles.heroRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroEyebrow}>
                    {isBroadcasting ? t("sharing.broadcastingLabel") : t("sharing.notBroadcastingLabel")}
                  </Text>
                  <Text style={styles.heroTitle}>{locationLabel}</Text>
                  <Text style={styles.heroSub}>
                    {location
                      ? `${Math.abs(location.latitude).toFixed(3)}°${location.latitude >= 0 ? "N" : "S"} · ${Math.abs(location.longitude).toFixed(3)}°${location.longitude >= 0 ? "E" : "W"}`
                      : t("sharing.noLocation")}
                  </Text>
                </View>
              </View>
              <View style={[styles.heroFooter, { borderTopColor: "rgba(255,255,255,0.2)" }]}>
                {[
                  { l: t("sharing.withCount"), v: String(activeRecipientCount) },
                  { l: t("sharing.mapVisible"), v: String(liveShares.length) },
                  { l: t("sharing.lastUpdate"), v: lastUpdateText },
                ].map((s) => (
                  <View key={s.l} style={styles.heroStat}>
                    <Text style={styles.heroStatLabel}>{s.l}</Text>
                    <Text style={styles.heroStatValue}>{s.v}</Text>
                  </View>
                ))}
              </View>
            </LinearGradient>
          </NomadCard>

          {isBroadcasting && broadcastInfo.lastError ? (
            <NomadCard theme={theme} style={[styles.warningCard, { backgroundColor: theme.stampSoft }]}>
              <View style={styles.encryptedRow}>
                <Icon name="alertTriangle" size={18} color={theme.stamp} />
                <Text style={[styles.encryptedText, { color: theme.stamp }]}>{t("sharing.publishFailed")}</Text>
              </View>
            </NomadCard>
          ) : null}

          <View style={styles.mapCard}>
            <NomadCard theme={theme} padding={10}>
              {initialRegion ? (
                <PostHogMaskView>
                  <MapView
                    ref={mapRef}
                    style={styles.realMap}
                    provider={PROVIDER_DEFAULT}
                    initialRegion={initialRegion}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    rotateEnabled={false}
                    pitchEnabled={false}
                    toolbarEnabled={false}
                    mapType="standard"
                  >
                    {userPoint && <Marker coordinate={userPoint} title={t("sharing.youLabel")} pinColor={theme.stamp} />}
                    {liveShares.map((share, index) => (
                      <Marker
                        key={share.ownerUserId}
                        coordinate={{ latitude: share.latitude, longitude: share.longitude }}
                        title={share.ownerName}
                        pinColor={colorFor(index)}
                      />
                    ))}
                  </MapView>
                </PostHogMaskView>
              ) : (
                <View style={[styles.realMap, styles.mapFallback, { backgroundColor: theme.paperSoft }]}>
                  <Icon name="globe" size={34} color={theme.inkMuted} />
                  <Text style={[styles.mapFallbackText, { color: theme.inkMuted }]}>{t("sharing.noLocation")}</Text>
                </View>
              )}
            </NomadCard>
          </View>

          {incomingRequests.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("sharing.requestsTitle")}</Text>
              </View>
              <View style={styles.peopleList}>
                {incomingRequests.map((req, index) => (
                  <NomadCard key={req.id} theme={theme} style={styles.personCard}>
                    <View style={styles.personRow}>
                      <View style={[styles.personAvatar, { backgroundColor: colorFor(index) }]}>
                        <Text style={styles.personInitial}>{initialOf(req.ownerName)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.personName, { color: theme.inkDeep }]}>{req.ownerName}</Text>
                        <Text style={[styles.personSub, { color: theme.inkSoft }]}>{t("sharing.requestBody")}</Text>
                      </View>
                    </View>
                    <View style={[styles.personFooter, { borderTopColor: theme.hairline, justifyContent: "flex-start", gap: 8 }]}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => handleRespond(req.id, true)}
                        style={({ pressed }) => [styles.linkAction, { backgroundColor: theme.tealSoft }, pressed && { opacity: 0.8 }]}
                      >
                        <Text style={[styles.linkActionText, { color: theme.teal }]}>{t("sharing.accept")}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => handleRespond(req.id, false)}
                        style={({ pressed }) => [
                          styles.linkAction,
                          { backgroundColor: theme.paperSoft, borderColor: theme.hairline, borderWidth: 1 },
                          pressed && { opacity: 0.8 },
                        ]}
                      >
                        <Text style={[styles.linkActionText, { color: theme.inkSoft }]}>{t("sharing.decline")}</Text>
                      </Pressable>
                    </View>
                  </NomadCard>
                ))}
              </View>
            </>
          )}

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("sharing.sharingWithYou")}</Text>
          </View>
          <View style={styles.peopleList}>
            {(incomingShares ?? []).length === 0 ? (
              <NomadCard theme={theme}>
                <Text style={[styles.emptyText, { color: theme.inkSoft }]}>{t("sharing.noneSharingWithYou")}</Text>
              </NomadCard>
            ) : (
              (incomingShares ?? []).map((share, index) => {
                const stale = nowTick - share.updatedAt > STALE_AFTER_MS;
                const distanceKm = userPoint ? haversineKm(userPoint, share) : null;
                return (
                  <NomadCard key={share.ownerUserId} theme={theme} style={styles.personCard}>
                    <View style={styles.personRow}>
                      <View style={[styles.personAvatar, { backgroundColor: colorFor(index) }]}>
                        <Text style={styles.personInitial}>{initialOf(share.ownerName)}</Text>
                        {!stale && <View style={[styles.personBadge, { backgroundColor: theme.teal, borderColor: theme.paperSoft }]} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.personName, { color: theme.inkDeep }]}>{share.ownerName}</Text>
                        <Text style={[styles.personSub, { color: stale ? theme.stamp : theme.inkSoft }]}>
                          {t("sharing.lastSeenAt", { time: formatTime(new Date(share.updatedAt)) })}
                          {distanceKm != null ? ` · ${formatKm(distanceKm)}` : ""}
                        </Text>
                      </View>
                      {share.battery != null && (
                        <Text style={[styles.personBattery, { color: share.battery < 0.3 ? theme.stamp : theme.inkDeep }]}>
                          {Math.round(share.battery * 100)}%
                        </Text>
                      )}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("sharing.openInMaps")}
                        onPress={() => Linking.openURL(`https://maps.google.com/?q=${share.latitude},${share.longitude}`).catch(() => {})}
                        style={({ pressed }) => [styles.mapButton, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }, pressed && { opacity: 0.8 }]}
                      >
                        <Icon name="mapPin" size={14} color={theme.inkDeep} />
                      </Pressable>
                    </View>
                  </NomadCard>
                );
              })
            )}
          </View>

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("sharing.sharedWith")}</Text>
            <Pressable accessibilityRole="button" onPress={() => setAddVisible(true)} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
              <Text style={[styles.addText, { color: theme.teal }]}>{t("sharing.addPerson")}</Text>
            </Pressable>
          </View>
          <View style={styles.peopleList}>
            {contactLinks === undefined ? (
              <ActivityIndicator color={theme.teal} />
            ) : outgoing.length === 0 && invites.length === 0 ? (
              <NomadCard theme={theme}>
                <Text style={[styles.emptyText, { color: theme.inkSoft }]}>{t("sharing.noRecipients")}</Text>
              </NomadCard>
            ) : (
              <>
                {outgoing.map((link, index) => {
                  const paused = pausedIds.has(link.linkedUserId);
                  return (
                    <NomadCard key={link.id} theme={theme} style={styles.personCard}>
                      <View style={styles.personRow}>
                        <View style={[styles.personAvatar, { backgroundColor: colorFor(index) }]}>
                          <Text style={styles.personInitial}>{initialOf(link.name)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.personName, { color: theme.inkDeep }]}>{link.name}</Text>
                          <Text style={[styles.personSub, { color: link.status === "declined" ? theme.stamp : theme.inkSoft }]}>
                            {link.status === "pending"
                              ? t("sharing.pendingStatus")
                              : link.status === "declined"
                                ? t("sharing.declinedStatus")
                                : paused
                                  ? t("sharing.sharingPaused")
                                  : isBroadcasting
                                    ? t("sharing.canSeeYou")
                                    : t("sharing.willSeeYou")}
                          </Text>
                        </View>
                        {link.status === "accepted" && (
                          <Pressable
                            accessibilityRole="switch"
                            accessibilityState={{ checked: !paused }}
                            accessibilityLabel={t("sharing.shareWith", { name: link.name })}
                            onPress={() => handleTogglePause(link)}
                            style={[styles.toggleTrack, { backgroundColor: paused ? theme.hairline : theme.teal }]}
                          >
                            <View style={[styles.toggleThumb, { left: paused ? 2 : 20, backgroundColor: "#fff" }]} />
                          </Pressable>
                        )}
                      </View>
                      <View style={[styles.personFooter, { borderTopColor: theme.hairline }]}>
                        {link.status === "accepted" && (
                          <Pressable onPress={() => handlePing(contactPhoneByEmail.get(link.email))} style={({ pressed }) => [styles.pingButton, pressed && { opacity: 0.7 }]}>
                            <Icon name="send" size={12} color={theme.teal} />
                            <Text style={[styles.pingText, { color: theme.teal }]}>{t("sharing.ping")}</Text>
                          </Pressable>
                        )}
                        <View style={{ flex: 1 }} />
                        <Pressable onPress={() => confirmRemoveLink(link.id, link.name)} hitSlop={8}>
                          <Text style={[styles.pingText, { color: theme.inkMuted }]}>{t("sharing.remove")}</Text>
                        </Pressable>
                      </View>
                    </NomadCard>
                  );
                })}
                {invites.map((invite) => (
                  <NomadCard key={invite.id} theme={theme} style={styles.personCard}>
                    <View style={styles.personRow}>
                      <View style={[styles.personAvatar, { backgroundColor: theme.inkMuted }]}>
                        <Text style={styles.personInitial}>{initialOf(invite.name)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.personName, { color: theme.inkDeep }]}>{invite.name}</Text>
                        <Text style={[styles.personSub, { color: theme.inkSoft }]}>{t("sharing.notInstalled")}</Text>
                      </View>
                      <Pressable onPress={() => sendInvite(invite)} style={({ pressed }) => [styles.inviteButton, pressed && { opacity: 0.8 }]}>
                        <Text style={[styles.inviteText, { color: theme.teal }]}>{t("sharing.invite")}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("sharing.remove")}
                        hitSlop={8}
                        onPress={() => removeInvite({ inviteId: invite.id }).catch(() => {})}
                      >
                        <Icon name="close" size={16} color={theme.inkMuted} />
                      </Pressable>
                    </View>
                  </NomadCard>
                ))}
              </>
            )}
          </View>

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("sharing.updateStrategy")}</Text>
          </View>
          <View style={styles.modeGrid}>
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <Pressable
                  key={m.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, disabled: busy }}
                  onPress={() => handleModeChange(m.id)}
                  style={({ pressed }) => [
                    styles.modeCard,
                    {
                      backgroundColor: active ? theme.inkDeep : theme.paperSoft,
                      borderColor: active ? theme.inkDeep : theme.hairline,
                    },
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Icon name={m.icon} size={18} color={active ? theme.paperSoft : theme.inkDeep} />
                  <Text style={[styles.modeLabel, { color: active ? theme.paperSoft : theme.inkDeep }]}>{t(m.labelKey)}</Text>
                  <Text style={[styles.modeSub, { color: active ? theme.paperSoft : theme.inkSoft }]}>{t(m.subKey)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.drainNote, { color: theme.inkMuted }]}>
            {remainingHours != null
              ? t("sharing.drainEstimate", { percent: drain, hours: remainingHours })
              : t("sharing.drainEstimateNoBattery", { percent: drain })}
          </Text>

          <NomadCard theme={theme} style={[styles.encryptedCard, { backgroundColor: theme.tealSoft }]}>
            <View style={styles.encryptedRow}>
              <Icon name="lock" size={18} color={theme.teal} />
              <Text style={[styles.encryptedText, { color: theme.teal }]}>{t("sharing.privacyNote")}</Text>
            </View>
          </NomadCard>

          <NomadButton
            theme={theme}
            variant={isBroadcasting ? "stamp" : "teal"}
            full
            disabled={busy}
            icon={busy ? <ActivityIndicator color="#fff" /> : <Icon name={isBroadcasting ? "pause" : "play"} size={18} color="#fff" />}
            onPress={handleToggleBroadcast}
            style={{ marginTop: 14, marginBottom: 120 }}
          >
            {isBroadcasting ? t("sharing.stopBroadcasting") : t("sharing.startBroadcasting")}
          </NomadButton>
        </ScrollView>
      </SafeAreaView>

      <BackgroundLocationDisclosure
        visible={disclosureVisible}
        onAccept={() => {
          setDisclosureVisible(false);
          beginBroadcast(mode);
        }}
        onDecline={() => setDisclosureVisible(false)}
      />
      <AddPersonSheet
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onSubmit={handleAddPerson}
        existingEmails={new Set([...outgoing.map((l) => l.email), ...invites.map((i) => i.email ?? "")])}
      />
    </View>
  );
}

function AddPersonSheet({
  visible,
  onClose,
  onSubmit,
  existingEmails,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; email: string; phone?: string }) => Promise<void>;
  existingEmails: Set<string>;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(
    () =>
      visible
        ? emergencyContactsStorage
            .get()
            .filter((c) => c.email && !existingEmails.has(normalizeEmail(c.email)))
        : [],
    [existingEmails, visible],
  );

  const close = () => {
    setName("");
    setEmail("");
    setPhone("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (saving) return;
    const cleanEmail = normalizeEmail(email);
    if (!name.trim()) return setError(t("sharing.nameRequired"));
    if (!EMAIL_RE.test(cleanEmail)) return setError(t("sharing.emailInvalid"));
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), email: cleanEmail, phone: phone.trim() || undefined });
      close();
    } catch {
      setError(t("sharing.linkErrorBody"));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: theme.paperSoft, borderColor: theme.hairline, color: theme.inkDeep }];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={[styles.sheetBackdrop, { backgroundColor: theme.scrim }]} onPress={close} accessibilityLabel={t("common.close")} />
        <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.paper }]}>
          <Text style={[styles.sheetTitle, { color: theme.inkDeep }]} accessibilityRole="header">{t("sharing.addTitle")}</Text>
          <Text style={[styles.personSub, { color: theme.inkSoft, marginBottom: 12 }]}>{t("sharing.addBody")}</Text>
          {suggestions.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
              {suggestions.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    setName(c.name);
                    setEmail(c.email ?? "");
                    setPhone(c.phone ?? "");
                  }}
                  style={({ pressed }) => [styles.linkAction, { backgroundColor: theme.tealSoft }, pressed && { opacity: 0.8 }]}
                >
                  <Text style={[styles.linkActionText, { color: theme.teal }]}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <TextInput value={name} onChangeText={setName} placeholder={t("sharing.namePlaceholder")} placeholderTextColor={theme.inkMuted} style={inputStyle} autoCapitalize="words" maxLength={80} />
          <TextInput value={email} onChangeText={setEmail} placeholder={t("sharing.emailPlaceholder")} placeholderTextColor={theme.inkMuted} style={inputStyle} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={254} />
          <TextInput value={phone} onChangeText={setPhone} placeholder={t("sharing.phonePlaceholder")} placeholderTextColor={theme.inkMuted} style={inputStyle} keyboardType="phone-pad" maxLength={32} />
          {error ? <Text style={[styles.personSub, { color: theme.stamp }]} accessibilityRole="alert">{error}</Text> : null}
          <NomadButton theme={theme} variant="teal" full onPress={submit} disabled={saving} style={{ marginTop: 12 }}>
            {saving ? t("common.saving") : t("sharing.sendRequest")}
          </NomadButton>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function formatAgo(ms: number, t: ReturnType<typeof useLocalization>["t"]) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return t("sharing.justNow");
  if (minutes < 60) return t("sharing.minutesShort", { count: minutes });
  return t("sharing.hoursShort", { count: Math.floor(minutes / 60) });
}

function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 140 },
  screenHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    marginBottom: 14,
  },
  screenSubtitle: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  screenTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 40,
    lineHeight: 42,
    fontWeight: "500",
    letterSpacing: -0.8,
    marginTop: 4,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  pillDot: { width: 6, height: 6, borderRadius: 999 },
  pillText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 10.5,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  heroGradient: {
    padding: 18,
    marginBottom: 14,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    position: "relative",
  },
  heroEyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: "700",
    color: "rgba(255,255,255,0.85)",
    textTransform: "uppercase",
  },
  heroTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 30,
    lineHeight: 32,
    color: "#fff",
    marginTop: 4,
    letterSpacing: -0.4,
  },
  heroSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
    marginTop: 6,
  },
  avatarStack: {
    flexDirection: "row",
    marginTop: 4,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  avatarText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 12,
    color: "#fff",
  },
  avatarLiveDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 999,
    borderWidth: 2,
  },
  heroFooter: {
    flexDirection: "row",
    gap: 6,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  heroStat: { flex: 1 },
  heroStatLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9,
    letterSpacing: 1,
    color: "rgba(255,255,255,0.75)",
    textTransform: "uppercase",
  },
  heroStatValue: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 18,
    fontWeight: "500",
    color: "#fff",
    marginTop: 2,
    letterSpacing: -0.2,
  },
  mapCard: { marginBottom: 14 },
  realMap: {
    width: "100%",
    height: 220,
    borderRadius: 12,
    overflow: "hidden",
  },
  mapFallback: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  mapFallbackText: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    textAlign: "center",
  },
  mapControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 2,
  },
  mapMeta: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 11,
  },
  mapButtons: { flexDirection: "row", gap: 4 },
  mapButton: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 6,
    marginBottom: 10,
  },
  sectionLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  sectionMeta: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 10,
    letterSpacing: 0.4,
  },
  modeGrid: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 14,
  },
  modeCard: {
    flex: 1,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
  },
  modeLabel: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  modeSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 9.5,
    marginTop: 2,
  },
  batteryCard: { marginBottom: 14 },
  batteryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  batteryValue: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 26,
    fontWeight: "500",
    marginTop: 4,
    lineHeight: 26,
  },
  batteryUnit: {
    fontSize: 14,
    fontStyle: "italic",
    fontWeight: "400",
  },
  batterySub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11,
    marginTop: 4,
  },
  batterySensors: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  sensorPills: {
    flexDirection: "row",
    gap: 3,
    marginTop: 6,
  },
  sensorPill: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  sensorPillText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    fontWeight: "700",
  },
  barChart: {
    flexDirection: "row",
    gap: 3,
    marginTop: 16,
    height: 44,
    alignItems: "flex-end",
  },
  bar: {
    flex: 1,
    borderRadius: 2,
  },
  barLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  barLabel: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 10,
  },
  peopleList: { gap: 8, marginBottom: 14 },
  personCard: { padding: 14 },
  personRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  personAvatar: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  personInitial: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 16,
    color: "#fff",
  },
  personBadge: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 999,
    borderWidth: 2,
  },
  personName: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 14,
    fontWeight: "600",
  },
  personSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11.5,
    marginTop: 1,
  },
  personBattery: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 11,
    fontWeight: "600",
  },
  batteryBar: {
    width: 28,
    height: 4,
    borderRadius: 2,
    marginTop: 3,
    overflow: "hidden",
  },
  batteryFill: { height: "100%" },
  toggleTrack: {
    width: 42,
    height: 24,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.08)",
    position: "relative",
    flexShrink: 0,
  },
  toggleThumb: {
    position: "absolute",
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  pendingPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  pendingText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 10,
    fontWeight: "600",
  },
  inviteButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  inviteText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 11,
    fontWeight: "600",
  },
  linkAction: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  linkActionText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 11,
    fontWeight: "600",
  },
  personFooter: {
    flexDirection: "row",
    gap: 16,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderStyle: "dashed",
  },
  personFooterLabel: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 9.5,
    letterSpacing: 0.6,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  personFooterValue: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  pingButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pingText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 11,
    fontWeight: "600",
  },
  addText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 11,
    fontWeight: "600",
  },
  geofenceList: { gap: 8, marginBottom: 14 },
  geofenceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  geofenceIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  geofenceName: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 13,
    fontWeight: "600",
  },
  geofenceSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11,
    marginTop: 1,
  },
  geofenceStatus: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  geofenceStatusText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  encryptedCard: { marginBottom: 14 },
  encryptedRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  encryptedText: {
    flex: 1,
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
    lineHeight: 18,
  },
  emptyText: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 12,
  },
  warningCard: { marginTop: 12, padding: 12 },
  drainNote: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 11.5,
    marginTop: 8,
    paddingHorizontal: 6,
  },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 15,
    marginBottom: 10,
  },
  sheetBackdrop: { flex: 1 },
  sheet: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  sheetTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 24,
    fontWeight: "500",
    marginBottom: 4,
  },
});
