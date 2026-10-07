import React, { useState } from "react";
import { showToast } from "@/atoms";
import { useLocalization } from "@/localization";
import { ExplainSheet } from "../components/ExplainSheet";
import { MAX_PICKED_PHOTOS } from "../services/tripPhotos";
import { useRecapStore } from "../store/recapStore";
import type { PhotoCuration } from "./usePhotoCuration";
import type { useTripWalking } from "./useTripWalking";

// The sheet's modal must be gone before iOS can present the picker or the Health screen.
const SHEET_CLOSE_MS = 320;
export const afterSheet = () => new Promise((resolve) => setTimeout(resolve, SHEET_CLOSE_MS));
const SOURCE_NAMES = { health_connect: "Health Connect", apple_health: "Apple Health" } as const;

/** Photos and steps for a replay, each explained in a sheet before a system screen opens. Render `sheets` once. */
export function useRecapExtras(curation: PhotoCuration, walking: ReturnType<typeof useTripWalking>) {
  const { t } = useLocalization();
  const [sheet, setSheet] = useState<"photos" | "steps" | "noSteps" | null>(null);
  const sourceName = walking.source ? SOURCE_NAMES[walking.source] : "";

  const choosePhotos = async () => {
    setSheet(null);
    await afterSheet();
    const before = curation.photos.length;
    const kept = await curation.choose();
    if (kept === null) return;
    showToast(kept > before ? t("recap.photosKept", { count: kept }) : t("recap.photosNoneKept"));
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
        title={t("recap.curateExplainTitle")}
        body={t("recap.curateExplainBody", { count: MAX_PICKED_PHOTOS })}
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
    sourceName,
    askPhotos: () => setSheet("photos"),
    askSteps: () => setSheet("steps"),
    sheets,
  };
}
