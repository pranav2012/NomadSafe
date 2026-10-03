import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Share, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AuraCard } from "@/components/aura/AuraCard";
import { AuraChip } from "@/components/aura/AuraChip";
import { AuraSection } from "@/components/aura/AuraSection";
import { useAura } from "@/components/aura/useAura";
import { Icon, type IconName } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { distanceKm } from "@/features/home/components/aura/globe/sun";
import { formatDistance } from "@/features/home/utils/format";
import { emergencyContactsStorage, normalizeEmail } from "@/features/onboarding/services/emergencyContactsStorage";
import { useLocalization } from "@/localization";
import { AddPersonSheet } from "./AddPersonSheet";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.pranav.nomadsafe";
const STALE_AFTER_MS = 15 * 60_000;
const AVATAR_COLORS = ["#8B97FF", "#22C7B8", "#FFB547", "#FF7A6B"];
const DANGER = "#FF4D5E";

type OutgoingLink = { id: Id<"contactLinks">; linkedUserId: string; name: string; email: string; status: "pending" | "accepted" | "declined" };
type IncomingLink = { id: Id<"contactLinks">; ownerUserId: string; ownerName: string; ownerEmail: string | null; status: "pending" | "accepted" | "declined" };
type Invite = { id: Id<"pendingInvites">; name: string; email: string | null; phone: string | null };
export type IncomingShare = { ownerUserId: string; ownerName: string; latitude: number; longitude: number; battery: number | null; updatedAt: number };

interface SharingPeopleProps {
  isBroadcasting: boolean;
  /** Your position, for distances and the SMS ping link. */
  location: { latitude: number; longitude: number } | null;
  accent: string;
}

/** Sharing requests, people sharing with you, and the people you share with. */
export function SharingPeople({ isBroadcasting, location, accent }: SharingPeopleProps) {
  const { c, f } = useAura();
  const { t, formatTime, locale } = useLocalization();
  const [addVisible, setAddVisible] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const contactLinks = useQuery(api.sharing.getContactLinks) as
    | { outgoing: OutgoingLink[]; incoming: IncomingLink[]; invites: Invite[] }
    | undefined;
  const incomingShares = useQuery(api.sharing.getIncomingShares) as IncomingShare[] | undefined;
  const outgoingShares = useQuery(api.sharing.getOutgoingShares);

  const requestContactLink = useMutation(api.sharing.requestContactLink);
  const respondToContactLink = useMutation(api.sharing.respondToContactLink);
  const removeContactLink = useMutation(api.sharing.removeContactLink);
  const removeInvite = useMutation(api.sharing.removeInvite);
  const setSharePaused = useMutation(api.sharing.setSharePaused);

  const pausedIds = useMemo(
    () => new Set((outgoingShares ?? []).filter((s) => s.paused).map((s) => s.recipientUserId)),
    [outgoingShares],
  );
  const outgoing = contactLinks?.outgoing ?? [];
  const invites = contactLinks?.invites ?? [];
  const requests = (contactLinks?.incoming ?? []).filter((l) => l.status === "pending");
  const sharingWithYou = incomingShares ?? [];

  const contactPhoneByEmail = useMemo(() => {
    const map = new Map<string, string>();
    emergencyContactsStorage.get().forEach((contact) => {
      if (contact.email && contact.phone) map.set(normalizeEmail(contact.email), contact.phone);
    });
    return map;
  }, []);

  const linkError = useCallback(() => Alert.alert(t("sharing.linkErrorTitle"), t("sharing.linkErrorBody")), [t]);

  const sendInvite = useCallback((invite: { name: string; phone?: string | null; email?: string | null }) => {
    const body = t("sharing.inviteMessage", { url: PLAY_STORE_URL });
    if (invite.phone) {
      Linking.openURL(`sms:${invite.phone}?body=${encodeURIComponent(body)}`).catch(() => Share.share({ message: body }));
    } else if (invite.email) {
      Linking.openURL(
        `mailto:${invite.email}?subject=${encodeURIComponent(t("sharing.inviteSubject"))}&body=${encodeURIComponent(body)}`,
      ).catch(() => Share.share({ message: body }));
    } else {
      Share.share({ message: body }).catch(() => {});
    }
  }, [t]);

  const handleAddPerson = useCallback(async (input: { name: string; email: string; phone?: string }) => {
    const res = await requestContactLink({ name: input.name, email: input.email, phone: input.phone });
    if (res.status === "invite_pending") {
      Alert.alert(t("sharing.notOnAppTitle", { name: input.name }), t("sharing.notOnAppBody"), [
        { text: t("common.later"), style: "cancel" },
        { text: t("sharing.sendInvite"), onPress: () => sendInvite(input) },
      ]);
    }
  }, [requestContactLink, sendInvite, t]);

  const confirmRemove = (linkId: Id<"contactLinks">, name: string) => {
    Alert.alert(t("sharing.removeTitle", { name }), t("sharing.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("sharing.remove"), style: "destructive", onPress: () => void removeContactLink({ linkId }).catch(linkError) },
    ]);
  };

  const ping = (phone: string | undefined) => {
    if (!phone) {
      Alert.alert(t("sharing.noPhoneTitle"), t("sharing.noPhoneBody"));
      return;
    }
    const body = location
      ? t("sharing.pingWithLocation", { url: `https://maps.google.com/?q=${location.latitude},${location.longitude}` })
      : t("sharing.pingNoLocation");
    Linking.openURL(`sms:${phone}?body=${encodeURIComponent(body)}`).catch(() => {});
  };

  const outgoingSub = (link: OutgoingLink) => {
    if (link.status === "pending") return t("sharing.pendingStatus");
    if (link.status === "declined") return t("sharing.declinedStatus");
    if (pausedIds.has(link.linkedUserId)) return t("sharing.sharingPaused");
    return isBroadcasting ? t("sharing.canSeeYou") : t("sharing.willSeeYou");
  };

  return (
    <View>
      <AuraSection
        title={t("safety.people")}
        action={<AuraChip label={t("sharing.addShort")} icon="plus" onPress={() => setAddVisible(true)} />}
      />

      {requests.length > 0 ? (
        <>
          <Text style={[styles.group, { color: c.textMuted, fontFamily: f.medium }]}>{t("sharing.requestsTitle")}</Text>
          <AuraCard style={styles.list}>
            {requests.map((req, i) => (
              <PersonRow key={req.id} name={req.ownerName} sub={t("sharing.requestBody")} color={AVATAR_COLORS[i % 4]} divider={i > 0}>
                <SmallAction label={t("sharing.accept")} filled onPress={() => void respondToContactLink({ linkId: req.id, accept: true }).catch(linkError)} />
                <SmallAction label={t("sharing.decline")} onPress={() => void respondToContactLink({ linkId: req.id, accept: false }).catch(linkError)} />
              </PersonRow>
            ))}
          </AuraCard>
        </>
      ) : null}

      <Text style={[styles.group, { color: c.textMuted, fontFamily: f.medium }]}>{t("sharing.sharingWithYou")}</Text>
      <AuraCard style={styles.list}>
        {sharingWithYou.length === 0 ? (
          <Text style={[styles.empty, { color: c.textMuted, fontFamily: f.regular }]}>{t("sharing.noneSharingWithYou")}</Text>
        ) : (
          sharingWithYou.map((share, i) => {
            const stale = now - share.updatedAt > STALE_AFTER_MS;
            const km = location ? distanceKm(location, share) : null;
            const sub = `${t("sharing.lastSeenAt", { time: formatTime(new Date(share.updatedAt)) })}${km != null ? ` · ${formatDistance(km, locale)}` : ""}`;
            return (
              <PersonRow
                key={share.ownerUserId}
                name={share.ownerName}
                sub={sub}
                subColor={stale ? DANGER : undefined}
                color={AVATAR_COLORS[i % 4]}
                live={!stale}
                divider={i > 0}
              >
                {share.battery != null ? (
                  <Text style={[styles.battery, { color: share.battery < 0.3 ? DANGER : c.textSoft, fontFamily: f.medium }]}>
                    {Math.round(share.battery * 100)}%
                  </Text>
                ) : null}
                <IconAction
                  icon="mapPin"
                  label={t("sharing.openInMaps")}
                  onPress={() => void Linking.openURL(`https://maps.google.com/?q=${share.latitude},${share.longitude}`).catch(() => {})}
                />
              </PersonRow>
            );
          })
        )}
      </AuraCard>

      <Text style={[styles.group, { color: c.textMuted, fontFamily: f.medium }]}>{t("sharing.sharedWith")}</Text>
      <AuraCard style={styles.list}>
        {contactLinks === undefined ? (
          <ActivityIndicator color={c.textMuted} style={styles.loading} />
        ) : outgoing.length === 0 && invites.length === 0 ? (
          <Text style={[styles.empty, { color: c.textMuted, fontFamily: f.regular }]}>{t("sharing.noRecipients")}</Text>
        ) : (
          <>
            {outgoing.map((link, i) => {
              const paused = pausedIds.has(link.linkedUserId);
              return (
                <PersonRow
                  key={link.id}
                  name={link.name}
                  sub={outgoingSub(link)}
                  subColor={link.status === "declined" ? DANGER : undefined}
                  color={AVATAR_COLORS[i % 4]}
                  divider={i > 0}
                  onLongPress={() => confirmRemove(link.id, link.name)}
                >
                  {link.status === "accepted" ? (
                    <>
                      <IconAction icon="send" label={t("sharing.ping")} onPress={() => ping(contactPhoneByEmail.get(link.email))} />
                      <AuraSwitch
                        value={!paused}
                        accent={accent}
                        label={t("sharing.shareWith", { name: link.name })}
                        onChange={() =>
                          void setSharePaused({ recipientUserId: link.linkedUserId, paused: !paused }).catch(linkError)
                        }
                      />
                    </>
                  ) : (
                    <IconAction icon="x" label={t("sharing.remove")} onPress={() => confirmRemove(link.id, link.name)} />
                  )}
                </PersonRow>
              );
            })}
            {invites.map((invite, i) => (
              <PersonRow key={invite.id} name={invite.name} sub={t("sharing.notInstalled")} color={c.textMuted} divider={outgoing.length + i > 0}>
                <SmallAction label={t("sharing.invite")} onPress={() => sendInvite(invite)} />
                <IconAction icon="x" label={t("sharing.remove")} onPress={() => void removeInvite({ inviteId: invite.id }).catch(() => {})} />
              </PersonRow>
            ))}
          </>
        )}
      </AuraCard>
      {outgoing.some((l) => l.status === "accepted") ? (
        <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("sharing.removeHint")}</Text>
      ) : null}

      <AddPersonSheet
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onSubmit={handleAddPerson}
        existingEmails={new Set([...outgoing.map((l) => l.email), ...invites.map((i) => i.email ?? "")])}
      />
    </View>
  );
}

interface PersonRowProps {
  name: string;
  sub: string;
  subColor?: string;
  color: string;
  live?: boolean;
  divider: boolean;
  onLongPress?: () => void;
  children?: React.ReactNode;
}

function PersonRow({ name, sub, subColor, color, live, divider, onLongPress, children }: PersonRowProps) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const content = (
    <>
      <View style={[styles.avatar, { backgroundColor: `${color}26`, borderColor: `${color}80` }]}>
        <Text style={[styles.initial, { color, fontFamily: f.semibold }]}>{(name.trim().charAt(0) || "?").toUpperCase()}</Text>
        {live ? <View style={[styles.liveBadge, { borderColor: c.card }]} /> : null}
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.name, { color: c.text, fontFamily: f.semibold }]}>
          {name}
        </Text>
        <Text numberOfLines={2} style={[styles.sub, { color: subColor ?? c.textMuted, fontFamily: f.regular }]}>
          {sub}
        </Text>
      </View>
      <View style={styles.trailing}>{children}</View>
    </>
  );
  const rowStyle = [styles.row, divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }];
  return onLongPress ? (
    <PressableScale
      onLongPress={onLongPress}
      pressedScale={0.99}
      haptic={false}
      accessibilityHint={t("sharing.removeHint")}
      accessibilityActions={[{ name: "longpress" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "longpress") onLongPress();
      }}
      style={rowStyle}
    >
      {content}
    </PressableScale>
  ) : (
    <View style={rowStyle}>{content}</View>
  );
}

function SmallAction({ label, filled, onPress }: { label: string; filled?: boolean; onPress: () => void }) {
  const { c, f } = useAura();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.small, { backgroundColor: filled ? c.inverse : c.surfaceStrong, borderColor: c.hairline }]}
    >
      <Text style={[styles.smallText, { color: filled ? c.onInverse : c.text, fontFamily: f.semibold }]}>{label}</Text>
    </PressableScale>
  );
}

function IconAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { c } = useAura();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={[styles.iconAction, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}
    >
      <Icon name={icon} size={14} color={c.text} />
    </PressableScale>
  );
}

function AuraSwitch({ value, accent, label, onChange }: { value: boolean; accent: string; label: string; onChange: () => void }) {
  const { c } = useAura();
  return (
    <PressableScale
      onPress={onChange}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={6}
      style={[styles.track, { backgroundColor: value ? accent : c.surfaceStrong, borderColor: c.hairline }]}
    >
      <View style={[styles.thumb, { left: value ? 20 : 2 }]} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  group: { fontSize: 13, marginBottom: 8, marginTop: 6 },
  list: { paddingVertical: 4, paddingHorizontal: 14, marginBottom: 14 },
  empty: { fontSize: 13.5, lineHeight: 19, paddingVertical: 12 },
  loading: { paddingVertical: 14 },
  hint: { fontSize: 12, marginTop: -6, marginBottom: 6, paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  initial: { fontSize: 16 },
  liveBadge: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, backgroundColor: "#3DDC97" },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15 },
  sub: { fontSize: 12.5, lineHeight: 17 },
  trailing: { flexDirection: "row", alignItems: "center", gap: 8 },
  battery: { fontSize: 12.5, fontVariant: ["tabular-nums"] },
  small: { height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  smallText: { fontSize: 12.5 },
  iconAction: { width: 32, height: 32, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  track: { width: 42, height: 24, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  thumb: { position: "absolute", top: 1.5, width: 20, height: 20, borderRadius: 10, backgroundColor: "#FFFFFF" },
});
