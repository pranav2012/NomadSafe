import type { NomadColors } from "@/constants/theme";
import type { IconName } from "@/components/nomad/Icon";

export type EventType = "transit" | "stay" | "activity";

export interface EventTypeMeta {
  id: EventType;
  color: keyof NomadColors;
  soft: keyof NomadColors;
  icon: IconName;
}

export const EVENT_TYPES: EventTypeMeta[] = [
  { id: "activity", color: "stamp", soft: "stampSoft", icon: "compass" },
  { id: "transit", color: "mustard", soft: "mustardSoft", icon: "car" },
  { id: "stay", color: "teal", soft: "tealSoft", icon: "building" },
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
