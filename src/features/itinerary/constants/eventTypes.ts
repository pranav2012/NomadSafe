import type { IconName } from "@/atoms";

export type EventType = "transit" | "stay" | "activity" | "food" | "note";

/** When an item happens: at its time (undefined), any time on its day, or not planned yet (wishlist). */
export type EventTiming = "anytime" | "wishlist";

/** How a transit event travels; drives the replay's leg colours and distance-by-mode stats. */
export type TransitMode = "flight" | "train" | "bus" | "car" | "ferry";

export const TRANSIT_MODES: { id: TransitMode; icon: IconName }[] = [
  { id: "flight", icon: "plane" },
  { id: "train", icon: "train" },
  { id: "bus", icon: "bus" },
  { id: "car", icon: "car" },
  { id: "ferry", icon: "ship" },
];

export function isTransitMode(value: unknown): value is TransitMode {
  return typeof value === "string" && TRANSIT_MODES.some((mode) => mode.id === value);
}

export interface EventTypeMeta {
  id: EventType;
  icon: IconName;
}

export const EVENT_TYPES: EventTypeMeta[] = [
  { id: "activity", icon: "compass" },
  { id: "food", icon: "utensils" },
  { id: "transit", icon: "car" },
  { id: "stay", icon: "building" },
  { id: "note", icon: "edit" },
];

/** Bookings happen at a set time; the rest can also be "anytime that day" or a wishlist idea. */
export function canBeUntimed(type: EventType): boolean {
  return type !== "stay" && type !== "transit";
}

export const EVENT_TYPE_IDS = EVENT_TYPES.map((meta) => meta.id);

const TYPE_BY_ID: Record<EventType, EventTypeMeta> = EVENT_TYPES.reduce(
  (acc, meta) => {
    acc[meta.id] = meta;
    return acc;
  },
  {} as Record<EventType, EventTypeMeta>,
);

export function getEventTypeMeta(id: EventType): EventTypeMeta {
  return TYPE_BY_ID[id] ?? TYPE_BY_ID.activity;
}

export function isEventType(value: string): value is EventType {
  return value in TYPE_BY_ID;
}
