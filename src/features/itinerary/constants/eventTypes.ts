import type { IconName } from "@/atoms";

export type EventType = "transit" | "stay" | "activity";

export interface EventTypeMeta {
  id: EventType;
  icon: IconName;
}

export const EVENT_TYPES: EventTypeMeta[] = [
  { id: "activity", icon: "compass" },
  { id: "transit", icon: "car" },
  { id: "stay", icon: "building" },
];

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
