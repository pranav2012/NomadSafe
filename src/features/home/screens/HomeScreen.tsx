import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import type { AuraStatus } from "@/constants/aura";
import { ExpenseForm } from "@/features/expenses/components/ExpenseForm";
import { ImportSheet } from "@/features/expenses/components/ImportSheet";
import { TripHome, type UserLocation } from "@/features/home/components/TripHome";
import { useHomeData } from "@/features/home/hooks/useHomeData";
import { useHomeViewed } from "@/features/home/hooks/useHomeViewed";
import { BackgroundLocationDisclosure } from "@/features/location-sharing/components/BackgroundLocationDisclosure";
import { useBroadcastToggle } from "@/features/location-sharing/hooks/useBroadcastToggle";
import { cancelCheckInNotifications, useSafetyStore } from "@/features/safety";
import { EverydayCards } from "@/features/home/components/EverydayCards";
import { EmptyHome } from "@/features/home/components/EmptyHome";
import { finishRecap, isRecapFinished, useRecapStore } from "@/features/recap";
import { RecapHomeCard } from "@/features/recap/components/RecapHomeCard";
import { TripFormSheet } from "@/features/trips/components/TripForm";
import { selectActiveTrip, useTripsStore } from "@/features/trips/store/tripsStore";
import { useTheme } from "@/hooks/useTheme";
import { useStartNewTrip } from "@/modules/billing";
import { getCurrentPosition, getLastKnownPosition, requestForegroundPermission, reverseGeocode } from "@/modules/location";
import { track } from "@/modules/analytics";
import { heavyImpact, successNotification } from "@/utils/haptics";

/**
 * Best-effort device position: current fix, else last known. Reverse geocoding only adds a city
 * label, so its failure never discards the coordinates.
 */
async function resolveUserLocation(): Promise<UserLocation | null> {
  try {
    const { status } = await requestForegroundPermission();
    if (status !== "granted") return null;
  } catch {
    return null;
  }

  let coords: { latitude: number; longitude: number } | null = null;
  try {
    coords = await getCurrentPosition("balanced");
  } catch {
    // Android throws when location services are off; try the cached fix.
  }
  if (!coords) {
    try {
      coords = await getLastKnownPosition();
    } catch {
      coords = null;
    }
  }
  if (!coords) return null;

  const location: UserLocation = { latitude: coords.latitude, longitude: coords.longitude };
  try {
    const [reverse] = await reverseGeocode(coords);
    if (reverse) {
      location.city = reverse.city ?? reverse.subregion ?? undefined;
      location.country = reverse.country ?? undefined;
    }
  } catch {
    // City label is optional.
  }
  return location;
}

export default function HomeScreen() {
  const { isDark } = useTheme();
  const router = useRouter();
  const startNewTrip = useStartNewTrip();
  const tripCount = useTripsStore((state) => state.trips.length);
  const activeTrip = useTripsStore(selectActiveTrip);
  const data = useHomeData();
  useHomeViewed();

  const safetyStatus = useSafetyStore((s) => s.status);
  const checkInDuration = useSafetyStore((s) => s.checkInDuration);
  const startTimer = useSafetyStore((s) => s.startTimer);
  const stopTimer = useSafetyStore((s) => s.stopTimer);
  const share = useBroadcastToggle();

  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importTab, setImportTab] = useState<"gmail" | "paste" | null>(null);
  const [extending, setExtending] = useState(false);
  const recapFinished = useRecapStore((s) => (activeTrip ? isRecapFinished(activeTrip, s.finished) : true));

  useEffect(() => {
    let mounted = true;
    resolveUserLocation().then((location) => {
      if (mounted && location) setUserLocation(location);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!activeTrip || !data) {
    return <EmptyHome tripCount={tripCount} onViewTrips={() => router.push("/trips")} onPlanTrip={() => startNewTrip()} everyday={<EverydayCards />} />;
  }

  const status: AuraStatus = safetyStatus === "emergency" ? "alert" : share.isBroadcasting ? "live" : "calm";
  const checkInActive = safetyStatus === "active";

  // Starting a check-in hands over to the Safety tab, which owns the timer UI and schedules its
  // reminders; completing one can happen right here.
  const handleCheckIn = () => {
    if (checkInActive) {
      stopTimer();
      void cancelCheckInNotifications();
      track("check_in_completed");
      successNotification();
      return;
    }
    startTimer(checkInDuration);
    track("check_in_started", { duration_minutes: Math.round(checkInDuration / 60) });
    heavyImpact();
    router.navigate("/(tabs)/sos");
  };

  return (
    <>
      <TripHome
        trip={activeTrip}
        data={data}
        isDark={isDark}
        status={status}
        userLocation={userLocation}
        checkInActive={checkInActive}
        onAddSpend={() => setFormOpen(true)}
        onImportSpends={setImportTab}
        onCheckIn={handleCheckIn}
        onToggleShare={() => void share.toggle()}
        onSos={() => router.navigate("/(tabs)/sos")}
        onSwitchTrip={() => router.push("/trips")}
        onOpenSettings={() => router.push("/settings")}
        topSlot={
          data.phase === "complete" && !recapFinished ? (
            <RecapHomeCard
              tripId={activeTrip.id}
              onWatch={() => router.push({ pathname: "/trip-recap/[id]", params: { id: activeTrip.id, source: "home" } })}
              onExtend={() => setExtending(true)}
              onDismiss={() => finishRecap(activeTrip.id)}
            />
          ) : null
        }
      />

      <TripFormSheet visible={extending} editingTrip={extending ? activeTrip : null} onClose={() => setExtending(false)} />

      <ExpenseForm
        visible={formOpen}
        groupId={activeTrip.id}
        tripCurrency={activeTrip.currency}
        companions={activeTrip.companions}
        onSave={() => setFormOpen(false)}
        onCancel={() => setFormOpen(false)}
        onSpeak={() => {
          setFormOpen(false);
          router.push({ pathname: "/voice-expense", params: { tripId: activeTrip.id } });
        }}
        onImport={(source) => {
          setFormOpen(false);
          setImportTab(source);
        }}
      />

      <ImportSheet
        visible={importTab !== null}
        groupId={activeTrip.id}
        trip={activeTrip}
        initialTab={importTab ?? "paste"}
        onClose={() => setImportTab(null)}
        onImported={() => setImportTab(null)}
      />

      <BackgroundLocationDisclosure visible={share.disclosureVisible} onAccept={share.onDisclosureAccept} onDecline={share.onDisclosureDecline} />
    </>
  );
}
