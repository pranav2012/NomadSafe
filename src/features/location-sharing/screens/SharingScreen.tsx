import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from "react-native-maps";
import * as Location from "expo-location";
import * as Battery from "expo-battery";
import { StatusBar } from "expo-status-bar";
import { useMutation } from "convex/react";
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
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { storage } from "@/stores/storage";
import { useAuthStore } from "@/features/auth";
import { api } from "@convex/_generated/api";
import {
  useSharingStore,
  getDrainPercentForMode,
  type ShareRecipient,
  type RecipientLinkStatus,
} from "../store/sharingStore";
import {
  startLocationBroadcast,
  stopLocationBroadcast,
} from "../services/locationBroadcastTask";
import {
  useIncomingShares,
  useContactLinks,
} from "../hooks/useConvexSharing";
import {
  refreshSharingToken,
} from "@/features/auth/services/authClient";
import { heavyImpact, successNotification } from "@/utils/haptics";
import type { LatLng } from "@/features/trips/store/tripsStore";

const MODES = [
  { id: "normal" as const, label: "Normal", sub: "~60s", icon: "compass" as const },
  { id: "low" as const, label: "Low-power", sub: "5 min", icon: "battery" as const },
  { id: "emergency" as const, label: "Max accuracy", sub: "15s", icon: "shield" as const },
];

const RECIPIENT_COLORS = ["teal", "mustard", "sky", "stamp"];

export default function SharingScreen() {
  const { nomad, isDark } = useTheme();
  const theme = nomad.colors;
  const card = nomad.components.card;
  const { t, formatTime } = useLocalization();

  const currentUser = useAuthStore((s) => s.user);

  const isBroadcasting = useSharingStore((s) => s.isBroadcasting);
  const mode = useSharingStore((s) => s.mode);
  const lastPublishedAt = useSharingStore((s) => s.lastPublishedAt);
  const recipients = useSharingStore((s) => s.recipients);
  const geofences = useSharingStore((s) => s.geofences);
  const currentBattery = useSharingStore((s) => s.currentBattery);
  const setBroadcasting = useSharingStore((s) => s.setBroadcasting);
  const setMode = useSharingStore((s) => s.setMode);
  const setCurrentBattery = useSharingStore((s) => s.setCurrentBattery);
  const setLastPublishedAt = useSharingStore((s) => s.setLastPublishedAt);
  const toggleRecipient = useSharingStore((s) => s.toggleRecipient);
  const updateRecipient = useSharingStore((s) => s.updateRecipient);
  const addRecipient = useSharingStore((s) => s.addRecipient);
  const addGeofence = useSharingStore((s) => s.addGeofence);
  const updateGeofence = useSharingStore((s) => s.updateGeofence);

  const requestContactLink = useMutation(api.sharing.requestContactLink);
  const respondToContactLink = useMutation(api.sharing.respondToContactLink);
  const pauseShare = useMutation(api.sharing.pauseShare);

  const incomingShares = useIncomingShares();
  const contactLinks = useContactLinks() as
    | { outgoing: ContactLink[]; incoming: { id: string; ownerUserId: string; email: string; status: RecipientLinkStatus }[] }
    | undefined;

  type ContactLink = { id: string; linkedUserId: string; email: string; status: RecipientLinkStatus };

  const trips = useTripsStore((s) => s.trips);
  const activeTripId = useTripsStore((s) => s.activeTripId);
  const activeTrip = trips.find((trip) => trip.id === activeTripId) ?? trips[0] ?? null;

  const [location, setLocation] = useState<{ latitude: number; longitude: number; city?: string; country?: string } | null>(null);
  const [nowTick, setNowTick] = useState(0);

  // Keep the background task auth token fresh whenever the screen is visible.
  useEffect(() => {
    refreshSharingToken();
  }, []);

  // Load real location and sync recipients from emergency contacts + Convex links.
  useEffect(() => {
    let mounted = true;
    async function init() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === Location.PermissionStatus.GRANTED) {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const [reverse] = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        if (mounted) {
          setLocation({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            city: reverse?.city ?? reverse?.subregion ?? undefined,
            country: reverse?.country ?? undefined,
          });
        }
      }

      const level = await Battery.getBatteryLevelAsync().catch(() => null);
      if (mounted && level !== null) setCurrentBattery(Math.round(level * 100));

      const storedRecipients = useSharingStore.getState().recipients;
      if (storedRecipients.length === 0) {
        const contacts = emergencyContactsStorage.get();
        contacts.slice(0, 3).forEach((c, index) => {
          const colorName = RECIPIENT_COLORS[index % RECIPIENT_COLORS.length];
          addRecipient({
            name: c.name,
            initial: c.name.charAt(0).toUpperCase(),
            color: theme[colorName as keyof typeof theme] as string,
            phone: c.phone,
            email: c.email,
          });
        });
      }

      const storedGeofences = useSharingStore.getState().geofences;
      if (storedGeofences.length === 0 && activeTrip?.destinations[0]) {
        const dest = activeTrip.destinations[0];
        const contacts = emergencyContactsStorage.get();
        addGeofence({
          name: t("sharing.arriveGeofence", { destination: dest }),
          radiusM: 2000,
          notifyIds: contacts.slice(0, 2).map((c) => c.id),
          active: true,
          color: "teal",
        });
      }

      const last = storage.getString("sharing-last-broadcast");
      if (last) {
        try {
          const parsed = JSON.parse(last) as { timestamp?: number };
          if (parsed.timestamp) setLastPublishedAt(parsed.timestamp);
        } catch {}
      }
    }
    init();
    return () => { mounted = false; };
  }, [activeTrip?.destinations, addGeofence, addRecipient, setCurrentBattery, setLastPublishedAt, t, theme]);

  // Link emergency contacts to NomadSafe users via email on first load.
  useEffect(() => {
    if (!currentUser) return;
    if (contactLinks === undefined) return;

    const storedRecipients = useSharingStore.getState().recipients;
    const contacts = emergencyContactsStorage.get();
    const outgoingLinks = contactLinks.outgoing ?? [];

    contacts.forEach((contact) => {
      const email = contact.email;
      if (!email) return;
      const normalized = normalizeEmail(email);
      const existing = storedRecipients.find((r) => normalizeEmail(r.email ?? "") === normalized);
      if (existing && existing.linkStatus !== "none") return;

      const outgoing = (outgoingLinks as ContactLink[]).find(
        (l) =>
          normalizeEmail(l.email) === normalized,
      );
      if (outgoing) {
        updateRecipient(existing?.id ?? contact.id, {
          linkStatus: outgoing.status,
          linkedUserId: outgoing.linkedUserId,
          convexLinkId: outgoing.id,
          sharing: outgoing.status === "accepted" ? existing?.sharing ?? true : false,
        });
      } else {
        requestContactLink({ name: contact.name, email: normalized, phone: contact.phone ?? undefined })
          .then((res) => {
            if (res.status !== "invite_pending") {
              updateRecipient(contact.id, {
                linkStatus: res.status as RecipientLinkStatus,
                linkedUserId: null,
                convexLinkId: res.linkId ?? null,
                sharing: res.status === "accepted",
              });
            }
          })
          .catch(() => {});
      }
    });
  }, [currentUser, contactLinks, requestContactLink, updateRecipient]);

  // Apply live incoming location shares from accepted linked contacts.
  useEffect(() => {
    if (!incomingShares?.length || !location) return;

    incomingShares.forEach((share: { ownerUserId: string; latitude: number; longitude: number; battery: number | null; updatedAt: number }) => {
      const recipient = recipients.find((r) => r.linkedUserId === share.ownerUserId);
      if (!recipient) return;

      const distanceKm = haversineKm(
        location.latitude,
        location.longitude,
        share.latitude,
        share.longitude,
      );
      updateRecipient(recipient.id, {
        lastSeenAt: share.updatedAt,
        battery: share.battery ?? null,
        distanceKm,
      });
    });
  }, [incomingShares, location, recipients, updateRecipient]);

  useEffect(() => {
    const update = () => setNowTick(Date.now());
    const id = setInterval(update, 1000);
    update();
    return () => clearInterval(id);
  }, []);

  const handleToggleBroadcast = useCallback(async () => {
    if (isBroadcasting) {
      try {
        await stopLocationBroadcast();
        setBroadcasting(false);
        successNotification();
      } catch {
        Alert.alert(t("sharing.stopErrorTitle"), t("sharing.stopErrorBody"));
      }
      return;
    }

    try {
      await refreshSharingToken();
      await startLocationBroadcast(mode);
      setBroadcasting(true);
      setLastPublishedAt(Date.now());
      heavyImpact();
    } catch {
      Alert.alert(
        t("sharing.permissionTitle"),
        t("sharing.permissionBody"),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("sharing.openSettings"), onPress: () => Linking.openSettings() },
        ],
      );
    }
  }, [isBroadcasting, mode, setBroadcasting, setLastPublishedAt, t]);

  const handleModeChange = useCallback(async (next: "normal" | "low" | "emergency") => {
    setMode(next);
    if (isBroadcasting) {
      try {
        await stopLocationBroadcast();
        await startLocationBroadcast(next);
      } catch {
        // restart attempt failed silently; keep new mode selected.
      }
    }
  }, [isBroadcasting, setMode]);

  const handleToggleRecipient = useCallback(async (recipient: ShareRecipient) => {
    const nextSharing = !recipient.sharing;
    toggleRecipient(recipient.id);

    if (!nextSharing && recipient.linkedUserId) {
      await pauseShare({ recipientUserId: recipient.linkedUserId });
    }
  }, [pauseShare, toggleRecipient]);

  const handleRespondToLink = useCallback(async (linkId: any, accept: boolean) => {
    try {
      await respondToContactLink({ linkId, accept });
    } catch {
      Alert.alert(t("sharing.linkErrorTitle"), t("sharing.linkErrorBody"));
    }
  }, [respondToContactLink, t]);

  const handleInvite = useCallback((recipient: ShareRecipient) => {
    const body = recipient.email
      ? `Join me on NomadSafe so we can share live locations safely: ${baseURL ?? "https://nomadsafe.app"}`
      : `Join me on NomadSafe so we can share live locations safely.`;
    if (recipient.phone) {
      Linking.openURL(`sms:${recipient.phone}?body=${encodeURIComponent(body)}`).catch(() => {});
    } else if (recipient.email) {
      Linking.openURL(`mailto:${recipient.email}?subject=${encodeURIComponent("Join me on NomadSafe")}&body=${encodeURIComponent(body)}`).catch(() => {});
    } else {
      Alert.alert(t("sharing.noContactTitle"), t("sharing.noContactBody"));
    }
  }, [t]);

  const drain = getDrainPercentForMode(mode);
  const remainingEstimate = currentBattery ? Math.round(currentBattery / drain) : 23;
  const lastUpdateText = lastPublishedAt
    ? formatLastUpdate(nowTick - lastPublishedAt, t)
    : t("sharing.neverUpdated");

  const locationLabel =
    location?.city && location?.country
      ? `${location.city}, ${location.country}`
      : activeTrip?.destinations[0] ?? t("sharing.fallbackLocation");

  const userPoint: LatLng | null = useMemo(
    () => (location ? { latitude: location.latitude, longitude: location.longitude } : null),
    [location],
  );

  // Only render recipient markers after we have a real incoming share location.
  const recipientPoints: { point: LatLng; recipient: ShareRecipient }[] = useMemo(() => {
    if (!userPoint) return [];
    return recipients
      .filter((r) => r.sharing && r.linkStatus === "accepted" && r.lastSeenAt != null)
      .map((r) => {
        const share = incomingShares?.find(
          (s: { ownerUserId: string; latitude: number; longitude: number }) => s.ownerUserId === r.linkedUserId,
        );
        if (!share) return null;
        return {
          point: { latitude: share.latitude, longitude: share.longitude },
          recipient: r,
        };
      })
      .filter((item): item is { point: LatLng; recipient: ShareRecipient } => item != null);
  }, [recipients, incomingShares, userPoint]);

  const allMapPoints: LatLng[] = useMemo(() => {
    const points: LatLng[] = [];
    if (userPoint) points.push(userPoint);
    points.push(...recipientPoints.map((p) => p.point));
    return points;
  }, [userPoint, recipientPoints]);

  const initialRegion: Region | null = useMemo(() => {
    if (allMapPoints.length === 0) return null;
    const minLat = Math.min(...allMapPoints.map((p) => p.latitude));
    const maxLat = Math.max(...allMapPoints.map((p) => p.latitude));
    const minLon = Math.min(...allMapPoints.map((p) => p.longitude));
    const maxLon = Math.max(...allMapPoints.map((p) => p.longitude));
    const latDelta = Math.max(0.04, (maxLat - minLat) * 1.6 + 0.02);
    const lonDelta = Math.max(0.04, (maxLon - minLon) * 1.6 + 0.02);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lonDelta,
    };
  }, [allMapPoints]);

  const mapRef = useRef<MapView>(null);
  useEffect(() => {
    if (allMapPoints.length === 0 || !mapRef.current) return;
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(allMapPoints, {
        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
        animated: true,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [allMapPoints]);

  const handlePing = useCallback((recipient: ShareRecipient) => {
    if (!recipient.phone) {
      Alert.alert(t("sharing.noPhoneTitle"), t("sharing.noPhoneBody"));
      return;
    }
    const body = location
      ? `Ping from NomadSafe · ${locationLabel}: https://maps.google.com/?q=${location.latitude},${location.longitude}`
      : `Ping from NomadSafe · I'm at ${locationLabel}`;
    Linking.openURL(`sms:${recipient.phone}?body=${encodeURIComponent(body)}`).catch(() => {});
  }, [location, locationLabel, t]);

  const openCurrentLocationInMaps = useCallback(() => {
    if (!location) return;
    const { latitude, longitude } = location;
    const url = `https://maps.google.com/?q=${latitude},${longitude}`;
    Linking.openURL(url).catch(() => {});
  }, [location]);

  const activeRecipients = recipients.filter((r) => r.sharing);

  return (
    <View style={{ flex: 1, backgroundColor: theme.paper }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.screenHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.screenSubtitle, { color: theme.inkMuted }]}>{t("sharing.eyebrow")}</Text>
              <Text style={[styles.screenTitle, { color: theme.inkDeep }]}>{t("sharing.title")}</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: isBroadcasting ? theme.tealSoft : theme.hairline }]}>
              <View style={[styles.pillDot, { backgroundColor: isBroadcasting ? theme.teal : theme.inkMuted }]} />
              <Text style={[styles.pillText, { color: isBroadcasting ? theme.teal : theme.inkMuted }]}>
                {isBroadcasting ? t("sharing.liveStatus", { count: activeRecipients.length }) : t("sharing.offlineStatus")}
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
                  <Text style={styles.heroEyebrow}>{t("sharing.broadcastingLabel")}</Text>
                  <Text style={styles.heroTitle}>
                    {location?.city ? (
                      <>
                        <Text style={{ fontStyle: "italic" }}>{location.city}</Text>
                        {location.country ? `, ${location.country}` : ""}
                      </>
                    ) : (
                      locationLabel
                    )}
                  </Text>
                  <Text style={styles.heroSub}>
                    {location
                      ? `${Math.abs(location.latitude).toFixed(3)}°${location.latitude >= 0 ? "N" : "S"} · ${Math.abs(location.longitude).toFixed(3)}°${location.longitude >= 0 ? "E" : "W"} · ±8m`
                      : t("sharing.noLocation")}
                  </Text>
                </View>
                <View style={styles.avatarStack}>
                  {recipients.slice(0, 3).map((r, i) => {
                    const isLive = r.lastSeenAt != null;
                    return (
                      <View
                        key={r.id}
                        style={[
                          styles.avatar,
                          { backgroundColor: r.color, marginLeft: i === 0 ? 0 : -8, borderColor: "#fff" },
                        ]}
                      >
                        <Text style={styles.avatarText}>{r.initial}</Text>
                        {isLive && (
                          <View
                            style={[
                              styles.avatarLiveDot,
                              {
                                backgroundColor: theme.teal,
                                borderColor: "#fff",
                              },
                            ]}
                          />
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>

              <View style={[styles.heroFooter, { borderTopColor: "rgba(255,255,255,0.2)" }]}>
                {[
                  { l: t("sharing.withCount"), v: String(activeRecipients.length) },
                  { l: t("sharing.mapVisible"), v: String(recipientPoints.length) },
                  { l: t("sharing.lastUpdate"), v: lastUpdateText },
                  { l: t("sharing.encryptedLabel"), v: t("sharing.encryptedShort") },
                ].map((s, i) => (
                  <View key={i} style={styles.heroStat}>
                    <Text style={styles.heroStatLabel}>{s.l}</Text>
                    <Text style={styles.heroStatValue}>{s.v}</Text>
                  </View>
                ))}
              </View>
            </LinearGradient>
          </NomadCard>

          <View style={styles.mapCard}>
            <NomadCard theme={theme} padding={10}>
              {initialRegion ? (
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
                  {userPoint && (
                    <Marker
                      coordinate={userPoint}
                      title={t("sharing.youLabel")}
                      pinColor={theme.stamp}
                    />
                  )}
                  {recipientPoints.map(({ point, recipient }) => (
                    <Marker
                      key={recipient.id}
                      coordinate={point}
                      title={recipient.name}
                      pinColor={recipient.color}
                    />
                  ))}
                </MapView>
              ) : (
                <View style={[styles.realMap, styles.mapFallback, { backgroundColor: theme.paperSoft }]}>
                  <Icon name="globe" size={34} color={theme.inkMuted} />
                  <Text style={[styles.mapFallbackText, { color: theme.inkMuted }]}>
                    {t("trip.mapNoCoordinates")}
                  </Text>
                </View>
              )}
              <View style={styles.mapControls}>
                <Text style={[styles.mapMeta, { color: theme.inkSoft }]}>
                  {t("sharing.visibleCount", { count: allMapPoints.length })} · {t("sharing.updatedAgo", { time: lastUpdateText })}
                </Text>
                <View style={styles.mapButtons}>
                  <Pressable
                    onPress={openCurrentLocationInMaps}
                    disabled={!location}
                    style={({ pressed }) => [
                      styles.mapButton,
                      { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
                      pressed && { opacity: 0.8 },
                      !location && { opacity: 0.4 },
                    ]}
                  >
                    <Icon name="mapPin" size={14} color={theme.inkDeep} />
                  </Pressable>
                </View>
              </View>
            </NomadCard>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("sharing.updateStrategy")}</Text>
            <Text style={[styles.sectionMeta, { color: theme.inkMuted }]}>{t("sharing.adaptiveHandoff")}</Text>
          </View>
          <View style={styles.modeGrid}>
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <Pressable
                  key={m.id}
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
                  <Text style={[styles.modeLabel, { color: active ? theme.paperSoft : theme.inkDeep }]}>{m.label}</Text>
                  <Text style={[styles.modeSub, { color: active ? theme.paperSoft : theme.inkSoft }]}>
                    {m.sub} · {getDrainPercentForMode(m.id)}%/h
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <NomadCard theme={theme} style={styles.batteryCard}>
            <View style={styles.batteryHeader}>
              <View>
                <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("sharing.projectedDrain")}</Text>
                <Text style={[styles.batteryValue, { color: theme.inkDeep }]}>
                  {drain}% <Text style={[styles.batteryUnit, { color: theme.inkSoft }]}>/ hr</Text>
                </Text>
                <Text style={[styles.batterySub, { color: theme.inkSoft }]}>
                  {t("sharing.estRemaining", { hours: remainingEstimate })}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.batterySensors, { color: theme.inkMuted }]}>{t("sharing.sensorsLabel")}</Text>
                <View style={styles.sensorPills}>
                  {["G", "C", "W"].map((c, i) => (
                    <View key={i} style={[styles.sensorPill, { backgroundColor: theme.tealSoft }]}>
                      <Text style={[styles.sensorPillText, { color: theme.teal }]}>{c}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.barChart}>
              {Array.from({ length: 24 }).map((_, i) => {
                const base = mode === "low" ? 12 : mode === "emergency" ? 28 : 18;
                const h = base + Math.sin(i * (mode === "emergency" ? 0.9 : 0.7)) * (mode === "emergency" ? 8 : 4);
                const crit = i > 20;
                return (
                  <View
                    key={i}
                    style={[
                      styles.bar,
                      {
                        height: Math.max(4, h),
                        backgroundColor: crit ? theme.stamp : mode === "emergency" ? theme.mustard : theme.teal,
                        opacity: 0.85,
                      },
                    ]}
                  />
                );
              })}
            </View>
            <View style={styles.barLabels}>
              <Text style={[styles.barLabel, { color: theme.inkMuted }]}>{t("sharing.nowLabel", { battery: currentBattery ?? 68 })}</Text>
              <Text style={[styles.barLabel, { color: theme.inkMuted }]}>6h</Text>
              <Text style={[styles.barLabel, { color: theme.inkMuted }]}>12h</Text>
              <Text style={[styles.barLabel, { color: theme.inkMuted }]}>18h</Text>
              <Text style={[styles.barLabel, { color: theme.inkMuted }]}>
                {t("sharing.endLabel", { battery: Math.max(10, (currentBattery ?? 68) - Math.round(drain * 24)) })}
              </Text>
            </View>
          </NomadCard>

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("sharing.sharedWith")}</Text>
            <Pressable style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
              <Text style={[styles.addText, { color: theme.teal }]}>{t("sharing.addPerson")}</Text>
            </Pressable>
          </View>
          <View style={styles.peopleList}>
            {recipients.length === 0 ? (
              <NomadCard theme={theme}>
                <Text style={[styles.emptyText, { color: theme.inkSoft }]}>{t("sharing.noRecipients")}</Text>
              </NomadCard>
            ) : (
              recipients.map((p) => (
                <NomadCard key={p.id} theme={theme} style={styles.personCard}>
                  <View style={styles.personRow}>
                    <View style={[styles.personAvatar, { backgroundColor: p.color }]}>
                      <Text style={styles.personInitial}>{p.initial}</Text>
                      {p.sharing && isRecipientBroadcasting(p, nowTick) && (
                        <View style={[styles.personBadge, { backgroundColor: theme.teal, borderColor: theme.paperSoft }]} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.personName, { color: theme.inkDeep }]}>{p.name}</Text>
                      <Text style={[styles.personSub, { color: theme.inkSoft }]}>
                        {formatRecipientStatus(p, nowTick, t)}
                      </Text>
                    </View>

                    {p.battery !== null && p.battery !== undefined && p.linkStatus === "accepted" && (
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[styles.personBattery, { color: p.battery < 30 ? theme.stamp : theme.inkDeep }]}>{p.battery}%</Text>
                        <View style={[styles.batteryBar, { backgroundColor: theme.hairline }]}>
                          <View style={[styles.batteryFill, { width: `${p.battery}%`, backgroundColor: p.battery < 30 ? theme.stamp : theme.teal }]} />
                        </View>
                      </View>
                    )}

                    {p.linkStatus === "accepted" ? (
                      <Pressable onPress={() => handleToggleRecipient(p)} style={styles.toggleTrack}>
                        <View style={[styles.toggleThumb, { left: p.sharing ? 20 : 2, backgroundColor: "#fff" }]} />
                      </Pressable>
                    ) : p.linkStatus === "pending" ? (
                      <View style={styles.pendingPill}>
                        <Text style={[styles.pendingText, { color: theme.inkMuted }]}>{t("sharing.pending")}</Text>
                      </View>
                    ) : p.linkStatus === "declined" ? (
                      <View style={styles.pendingPill}>
                        <Text style={[styles.pendingText, { color: theme.stamp }]}>{t("sharing.declined")}</Text>
                      </View>
                    ) : (
                      <Pressable onPress={() => handleInvite(p)} style={({ pressed }) => [styles.inviteButton, pressed && { opacity: 0.8 }]}>
                        <Text style={[styles.inviteText, { color: theme.teal }]}>{t("sharing.invite")}</Text>
                      </Pressable>
                    )}
                  </View>

                  {p.linkStatus === "pending" && p.convexLinkId && (
                    <View style={[styles.personFooter, { borderTopColor: theme.hairline, justifyContent: "flex-start", gap: 8 }]}>
                      <Pressable
                        onPress={() => handleRespondToLink(p.convexLinkId!, true)}
                        style={({ pressed }) => [
                          styles.linkAction,
                          { backgroundColor: theme.tealSoft },
                          pressed && { opacity: 0.8 },
                        ]}
                      >
                        <Text style={[styles.linkActionText, { color: theme.teal }]}>{t("sharing.accept")}</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleRespondToLink(p.convexLinkId!, false)}
                        style={({ pressed }) => [
                          styles.linkAction,
                          { backgroundColor: theme.paperSoft, borderColor: theme.hairline, borderWidth: 1 },
                          pressed && { opacity: 0.8 },
                        ]}
                      >
                        <Text style={[styles.linkActionText, { color: theme.inkSoft }]}>{t("sharing.decline")}</Text>
                      </Pressable>
                    </View>
                  )}

                  {p.sharing && p.linkStatus === "accepted" && (
                    <View style={[styles.personFooter, { borderTopColor: theme.hairline }]}>
                      <View>
                        <Text style={[styles.personFooterLabel, { color: theme.inkMuted }]}>{t("sharing.distance")}</Text>
                        <Text style={[styles.personFooterValue, { color: theme.inkDeep }]}>{p.distanceKm != null ? `${p.distanceKm.toLocaleString()} km` : "—"}</Text>
                      </View>
                      <View>
                        <Text style={[styles.personFooterLabel, { color: theme.inkMuted }]}>{t("sharing.since")}</Text>
                        <Text style={[styles.personFooterValue, { color: theme.inkDeep }]}>
                          {p.lastSeenAt ? formatTime(new Date(p.lastSeenAt)) : t("sharing.justStarted")}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }} />
                      <Pressable onPress={() => handlePing(p)} style={({ pressed }) => [styles.pingButton, pressed && { opacity: 0.7 }]}>
                        <Icon name="send" size={12} color={theme.teal} />
                        <Text style={[styles.pingText, { color: theme.teal }]}>{t("sharing.ping")}</Text>
                      </Pressable>
                    </View>
                  )}
                </NomadCard>
              ))
            )}
          </View>

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: theme.inkMuted }]}>{t("sharing.geofences")}</Text>
          </View>
          <View style={styles.geofenceList}>
            {geofences.length === 0 ? (
              <NomadCard theme={theme}>
                <Text style={[styles.emptyText, { color: theme.inkSoft }]}>{t("sharing.noGeofences")}</Text>
              </NomadCard>
            ) : (
              geofences.map((g) => (
                <NomadCard key={g.id} theme={theme} style={styles.geofenceCard}>
                  <View style={[styles.geofenceIcon, { backgroundColor: theme[`${g.color}Soft` as keyof typeof theme] as string }]}>
                    <Icon name="mapPin" size={16} color={theme[g.color]} strokeWidth={1.8} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.geofenceName, { color: theme.inkDeep }]}>{g.name}</Text>
                    <Text style={[styles.geofenceSub, { color: theme.inkSoft }]}>
                      {t("sharing.notifyCount", { count: g.notifyIds.length })} · {t("sharing.radius", { radius: g.radiusM })}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => updateGeofence(g.id, { active: !g.active })}
                    style={({ pressed }) => [
                      styles.geofenceStatus,
                      { backgroundColor: g.active ? theme.tealSoft : theme.hairline },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={[styles.geofenceStatusText, { color: g.active ? theme.teal : theme.inkMuted }]}>
                      {g.active ? t("sharing.on") : t("sharing.off")}
                    </Text>
                  </Pressable>
                </NomadCard>
              ))
            )}
          </View>

          <NomadCard theme={theme} style={[styles.encryptedCard, { backgroundColor: theme.tealSoft }]}>
            <View style={styles.encryptedRow}>
              <Icon name="lock" size={18} color={theme.teal} />
              <Text style={[styles.encryptedText, { color: theme.teal }]}>
                <Text style={{ fontWeight: "700" }}>{t("sharing.encryptedBold")}</Text>
                {" "}
                {t("sharing.encryptedBody")}
              </Text>
            </View>
          </NomadCard>

          <NomadButton
            theme={theme}
            variant={isBroadcasting ? "stamp" : "teal"}
            full
            icon={<Icon name={isBroadcasting ? "pause" : "play"} size={18} color="#fff" />}
            onPress={handleToggleBroadcast}
            style={{ marginTop: 14, marginBottom: 120 }}
          >
            {isBroadcasting ? t("sharing.stopBroadcasting") : t("sharing.startBroadcasting")}
          </NomadButton>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function formatLastUpdate(ms: number, t: ReturnType<typeof useLocalization>["t"]) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return t("sharing.justNow");
  if (seconds < 120) return "1m";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function isRecipientBroadcasting(recipient: ShareRecipient, nowTick: number) {
  if (!recipient.sharing || recipient.lastSeenAt == null) return false;
  return nowTick - recipient.lastSeenAt < 90_000;
}

function formatRecipientStatus(
  recipient: ShareRecipient,
  nowTick: number,
  t: ReturnType<typeof useLocalization>["t"],
) {
  if (recipient.linkStatus === "not_user") return t("sharing.notInstalled");
  if (recipient.linkStatus === "pending") return t("sharing.pendingStatus");
  if (recipient.linkStatus === "declined") return t("sharing.declinedStatus");
  if (!recipient.sharing) return t("sharing.sharingPaused");
  if (recipient.lastSeenAt == null) return t("sharing.awaitingLocation");
  const seconds = Math.max(0, Math.floor((nowTick - recipient.lastSeenAt) / 1000));
  if (seconds < 60) return t("sharing.lastSeenNow");
  if (seconds < 120) return t("sharing.lastSeenMinutes", { count: 1 });
  if (seconds < 3600) return t("sharing.lastSeenMinutes", { count: Math.floor(seconds / 60) });
  return t("sharing.lastSeenHours", { count: Math.floor(seconds / 3600) });
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

const baseURL = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;

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
});
