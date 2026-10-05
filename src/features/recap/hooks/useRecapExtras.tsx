import React, { useState } from "react";
import { showToast } from "@/atoms";
import type { Trip } from "@/features/trips/store/tripsStore";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { ExplainSheet } from "../components/ExplainSheet";
import { MAX_TRIP_PHOTOS, pickTripPhotos } from "../services/tripPhotos";
import { useRecapStore } from "../store/recapStore";
import { useTripPhotosStore, type TripPhoto } from "../store/tripPhotosStore";
import { useTripWalking } from "./useTripWalking";

const EMPTY: TripPhoto[] = [];
// The sheet's modal must be gone before iOS can present the picker or the Health screen.
const SHEET_CLOSE_MS = 320;
const afterSheet = () => new Promise((resolve) => setTimeout(resolve, SHEET_CLOSE_MS));
const SOURCE_NAMES = { health_connect: "Health Connect", apple_health: "Apple Health" } as const;

/** Photos and steps for a recap, each explained in a sheet before a system screen opens. Render `sheets` once. */
export function useRecapExtras(trip: Trip | null) {
  const { t } = useLocalization();
  const photos = useTripPhotosStore((state) => (trip ? (state.photos[trip.id] ?? EMPTY) : EMPTY));
  const walking = useTripWalking(trip);
  const [sheet, setSheet] = useState<"photos" | "steps" | "noSteps" | null>(null);
  const sourceName = walking.source ? SOURCE_NAMES[walking.source] : "";

  const choosePhotos = async () => {
    setSheet(null);
    if (!trip) return;
    await afterSheet();
    const added = await pickTripPhotos(trip.id);
    if (added > 0) {
      track("trip_photos_added", { count: added });
      showToast(t("recap.photosAdded", { count: added }));
    }
  };

  const linkSteps = async () => {
    setSheet(null);
    if (walking.needsInstall) {
      walking.openInstall();
      return;
    }
    await afterSheet();
    const totals = await walking.link();
    if (!totals && useRecapStore.getState().healthLinked) setSheet("noSteps");
  };

  const sheets = (
    <>
      <ExplainSheet
        visible={sheet === "photos"}
        onClose={() => setSheet(null)}
        icon="camera"
        title={t("recap.photosExplainTitle")}
        body={t("recap.photosExplainBody", { count: MAX_TRIP_PHOTOS })}
        action={t("recap.photosChoose")}
        onAction={() => void choosePhotos()}
        dismiss={t("recap.notNow")}
      />
      <ExplainSheet
        visible={sheet === "steps"}
        onClose={() => setSheet(null)}
        icon="heart"
        title={t("recap.healthExplainTitle", { source: sourceName })}
        body={walking.needsInstall ? t("recap.healthInstallBody") : t("recap.healthExplainBody", { source: sourceName })}
        action={walking.needsInstall ? t("recap.healthInstall") : t("recap.healthContinue")}
        onAction={() => void linkSteps()}
        dismiss={t("recap.notNow")}
      />
      <ExplainSheet
        visible={sheet === "noSteps"}
        onClose={() => setSheet(null)}
        icon="footprints"
        title={t("recap.noWalkingTitle")}
        body={t("recap.noWalkingBody", { source: sourceName })}
        action={t("common.ok")}
        onAction={() => setSheet(null)}
      />
    </>
  );

  return {
    photos,
    walking,
    canAddPhotos: photos.length < MAX_TRIP_PHOTOS,
    askPhotos: () => setSheet("photos"),
    askSteps: () => setSheet("steps"),
    sheets,
  };
}
