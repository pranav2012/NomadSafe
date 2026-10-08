import { useBoundaryStore } from "../../src/features/recap/utils/boundaries";
export * from "../../src/features/passport/utils/regions";
export { countryAt as __countryAt } from "../../src/features/recap/utils/countryShapes";
export const __setView = (view: "default" | "IN") => useBoundaryStore.getState().setView(view);
