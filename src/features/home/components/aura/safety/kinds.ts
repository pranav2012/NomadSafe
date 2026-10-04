import type { IconName } from "@/atoms";
import type { SafetyKind } from "@/features/home/hooks/useTripSafety";

export const SAFETY_KIND_META: Record<SafetyKind, { labelKey: string; icon: IconName; color: string }> = {
  hospital: { labelKey: "home.kindHospital", icon: "heart", color: "#FF5A67" },
  police: { labelKey: "home.kindPolice", icon: "shield", color: "#5B8CFF" },
  pharmacy: { labelKey: "home.kindPharmacy", icon: "plus", color: "#2BC48A" },
};
