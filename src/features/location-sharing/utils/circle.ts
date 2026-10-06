export type BroadcastMode = "normal" | "low" | "emergency";

export const LOW_BATTERY_LEVEL = 0.2;
export const LOW_BATTERY_RESUME_LEVEL = 0.3;
export const SHARE_STALE_AFTER_MS = 15 * 60_000;

/**
 * The update mode for the current battery level (0–1). Normal and low switch automatically with a
 * gap between the two levels so it doesn't flip back and forth; emergency (SOS) never changes.
 */
export function batteryMode(mode: BroadcastMode, battery: number | null | undefined): BroadcastMode {
  if (mode === "emergency" || battery == null || battery < 0) return mode;
  if (mode === "normal" && battery <= LOW_BATTERY_LEVEL) return "low";
  if (mode === "low" && battery >= LOW_BATTERY_RESUME_LEVEL) return "normal";
  return mode;
}

export type LinkStatus = "pending" | "accepted" | "declined";

export interface OutgoingLinkInput {
  id: string;
  linkedUserId: string;
  name: string;
  email: string;
  status: LinkStatus;
}

export interface IncomingLinkInput {
  id: string;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string | null;
  status: LinkStatus;
}

export interface InviteInput {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface IncomingShareInput {
  ownerUserId: string;
  ownerName: string;
  latitude: number;
  longitude: number;
  battery: number | null;
  updatedAt: number;
}

export interface OutgoingShareInput {
  recipientUserId: string;
  paused: boolean;
}

export interface CircleLocation {
  latitude: number;
  longitude: number;
  battery: number | null;
  updatedAt: number;
  stale: boolean;
}

/**
 * One person in the circle. `status` is how your link to them stands: "accepted" means they get your
 * SOS and missed-timer alerts and can see you while you share; "invited" means they don't have the app yet.
 * `location` is set while they share their location with you.
 */
export interface CirclePerson {
  key: string;
  name: string;
  email: string | null;
  userId: string | null;
  linkId: string | null;
  inviteId: string | null;
  status: "accepted" | "pending" | "declined" | "invited" | "none";
  seesYou: boolean;
  location: CircleLocation | null;
}

export interface CircleRequest {
  linkId: string;
  name: string;
  email: string | null;
}

export interface Circle {
  people: CirclePerson[];
  requests: CircleRequest[];
  alertCount: number;
  seesYouCount: number;
  sharingWithYou: CirclePerson[];
}

const STATUS_ORDER: Record<CirclePerson["status"], number> = { accepted: 0, none: 1, pending: 2, invited: 3, declined: 4 };

/**
 * Merges your links, invites and the shares in both directions into one list of people. Someone you
 * added and who also added you is one person; people who only share with you are listed too.
 */
export function buildCircle(input: {
  outgoing: OutgoingLinkInput[];
  incoming: IncomingLinkInput[];
  invites: InviteInput[];
  incomingShares: IncomingShareInput[];
  outgoingShares: OutgoingShareInput[];
  now: number;
}): Circle {
  const paused = new Set(input.outgoingShares.filter((s) => s.paused).map((s) => s.recipientUserId));
  const shareByOwner = new Map(
    input.incomingShares
      .filter((s) => !(s.latitude === 0 && s.longitude === 0))
      .map((s) => [s.ownerUserId, s] as const),
  );
  const toLocation = (share: IncomingShareInput | undefined): CircleLocation | null =>
    share
      ? {
          latitude: share.latitude,
          longitude: share.longitude,
          battery: share.battery,
          updatedAt: share.updatedAt,
          stale: input.now - share.updatedAt > SHARE_STALE_AFTER_MS,
        }
      : null;

  const people: CirclePerson[] = [];
  const seen = new Set<string>();

  for (const link of input.outgoing) {
    seen.add(link.linkedUserId);
    people.push({
      key: `link-${link.id}`,
      name: link.name,
      email: link.email,
      userId: link.linkedUserId,
      linkId: link.id,
      inviteId: null,
      status: link.status,
      seesYou: link.status === "accepted" && !paused.has(link.linkedUserId),
      location: toLocation(shareByOwner.get(link.linkedUserId)),
    });
  }

  // People who added you (and you accepted) but whom you haven't added back still share with you.
  for (const link of input.incoming) {
    if (link.status !== "accepted" || seen.has(link.ownerUserId)) continue;
    seen.add(link.ownerUserId);
    people.push({
      key: `in-${link.id}`,
      name: link.ownerName,
      email: link.ownerEmail,
      userId: link.ownerUserId,
      linkId: null,
      inviteId: null,
      status: "none",
      seesYou: false,
      location: toLocation(shareByOwner.get(link.ownerUserId)),
    });
  }

  for (const share of input.incomingShares) {
    if (seen.has(share.ownerUserId) || !shareByOwner.has(share.ownerUserId)) continue;
    seen.add(share.ownerUserId);
    people.push({
      key: `share-${share.ownerUserId}`,
      name: share.ownerName,
      email: null,
      userId: share.ownerUserId,
      linkId: null,
      inviteId: null,
      status: "none",
      seesYou: false,
      location: toLocation(share),
    });
  }

  for (const invite of input.invites) {
    people.push({
      key: `invite-${invite.id}`,
      name: invite.name,
      email: invite.email,
      userId: null,
      linkId: null,
      inviteId: invite.id,
      status: "invited",
      seesYou: false,
      location: null,
    });
  }

  people.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));

  return {
    people,
    requests: input.incoming
      .filter((link) => link.status === "pending")
      .map((link) => ({ linkId: link.id, name: link.ownerName, email: link.ownerEmail })),
    alertCount: people.filter((p) => p.status === "accepted").length,
    seesYouCount: people.filter((p) => p.seesYou).length,
    sharingWithYou: people.filter((p) => p.location !== null),
  };
}
