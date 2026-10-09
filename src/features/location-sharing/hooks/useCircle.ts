import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Share } from "react-native";
import { api, type Id, useMutation, useQuery } from "@/modules/backend";
import { track } from "@/modules/analytics";
import { showAlert, showToast } from "@/atoms";
import { circleInviteUrl } from "@/constants/legal";
import { registerGroupPush } from "@/features/sync";
import { useLocalization } from "@/localization";
import { useAppActive } from "@/hooks/useAnimationsActive";
import { buildCircle, nextStaleAt, type Circle, type CirclePerson, type IncomingShareInput } from "../utils/circle";
import { useLastLoaded } from "./useSharingQueries";

const EMPTY = { outgoing: [], incoming: [], invites: [] };

type ContactLinks = {
  outgoing: { id: Id<"contactLinks">; linkedUserId: string; name: string; email: string; status: "pending" | "accepted" | "declined" }[];
  incoming: { id: Id<"contactLinks">; ownerUserId: string; ownerName: string; ownerEmail: string | null; status: "pending" | "accepted" | "declined" }[];
  invites: { id: Id<"pendingInvites">; name: string; email: string | null; phone: string | null }[];
};

/** Names of accepted circle members, in the circle's order; reads only the contact links, not live locations. */
export function useCircleNames(): string[] {
  const appActive = useAppActive();
  const links = useLastLoaded(useQuery(api.sharing.getContactLinks, appActive ? {} : "skip") as ContactLinks | undefined);
  return useMemo(
    () =>
      (links?.outgoing ?? [])
        .filter((link) => link.status === "accepted")
        .map((link) => link.name)
        .sort((a, b) => a.localeCompare(b)),
    [links],
  );
}

/**
 * Your circle: the people who get your SOS and missed-timer alerts, see you while you share, and
 * share with you. `loaded` is false until the links have arrived from the server.
 */
export function useCircle(): Circle & {
  loaded: boolean;
  add: (input: { name: string; email: string }) => Promise<void>;
  remove: (person: CirclePerson) => Promise<void>;
  respond: (linkId: string, accept: boolean) => Promise<void>;
  setSeesYou: (userId: string, on: boolean) => Promise<void>;
  sendInvite: (person: { name: string; email: string | null }, from?: "invited_person" | "email_not_found") => void;
  shareInviteLink: () => void;
  resetInviteLink: () => void;
} {
  const { t } = useLocalization();
  const appActive = useAppActive();
  const [now, setNow] = useState(() => Date.now());

  // Subscriptions pause in the background; the last values stay on screen.
  const links = useLastLoaded(useQuery(api.sharing.getContactLinks, appActive ? {} : "skip") as ContactLinks | undefined);
  const incomingShares = useLastLoaded(
    useQuery(api.sharing.getIncomingShares, appActive ? {} : "skip") as IncomingShareInput[] | undefined,
  );
  const outgoingShares = useLastLoaded(useQuery(api.sharing.getOutgoingShares, appActive ? {} : "skip"));

  // Re-render only when someone's location turns stale (and on return to the app), not on a fixed tick.
  const staleAt = nextStaleAt(incomingShares ?? [], now);
  useEffect(() => {
    if (!appActive) return;
    const delay = staleAt !== null ? Math.max(0, staleAt - Date.now()) + 50 : Date.now() - now > 1000 ? 0 : null;
    if (delay === null) return;
    const id = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(id);
  }, [appActive, now, staleAt]);

  const requestContactLink = useMutation(api.sharing.requestContactLink);
  const respondToContactLink = useMutation(api.sharing.respondToContactLink);
  const removeContactLink = useMutation(api.sharing.removeContactLink);
  const removeInvite = useMutation(api.sharing.removeInvite);
  const setSharePaused = useMutation(api.sharing.setSharePaused);
  const circleInviteCode = useMutation(api.sharing.circleInviteCode);
  const resetCircleInviteCode = useMutation(api.sharing.resetCircleInviteCode);

  const circle = useMemo(
    () =>
      buildCircle({
        ...(links ?? EMPTY),
        incomingShares: incomingShares ?? [],
        outgoingShares: outgoingShares ?? [],
        now,
      }),
    [incomingShares, links, now, outgoingShares],
  );

  const linkError = useCallback(() => showAlert(t("sharing.linkErrorTitle"), t("sharing.linkErrorBody")), [t]);

  const inviteError = useCallback(() => showAlert(t("sharing.linkErrorTitle"), t("circle.inviteFailed")), [t]);

  /** The share text with the caller's circle link (made on first use); joining it links both people. */
  const inviteMessage = useCallback(async () => {
    const { code } = await circleInviteCode({});
    return t("circle.inviteMessage", { url: circleInviteUrl(code) });
  }, [circleInviteCode, t]);

  const shareInviteLink = useCallback(() => {
    void inviteMessage()
      .then((message) => Share.share({ message }).then(() => track("circle_invite_shared", { from: "add_sheet" })))
      .catch(inviteError);
  }, [inviteError, inviteMessage]);

  /** Sends the circle link to someone added by email who isn't on NomadSafe yet: by email when we have it, else the share sheet. */
  const sendInvite = useCallback((person: { name: string; email: string | null }, from: "invited_person" | "email_not_found" = "invited_person") => {
    void inviteMessage()
      .then(async (body) => {
        const share = () => Share.share({ message: body }).catch(() => {});
        track("circle_invite_shared", { from });
        if (!person.email) return void share();
        await Linking.openURL(
          `mailto:${person.email}?subject=${encodeURIComponent(t("sharing.inviteSubject"))}&body=${encodeURIComponent(body)}`,
        ).catch(share);
      })
      .catch(inviteError);
  }, [inviteError, inviteMessage, t]);

  const resetInviteLink = useCallback(() => {
    showAlert(t("circle.resetLinkTitle"), t("circle.resetLinkBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("circle.resetLink"),
        style: "destructive",
        onPress: () =>
          void resetCircleInviteCode({})
            .then(() => {
              track("circle_invite_reset");
              showToast(t("circle.resetLinkDone"));
            })
            .catch(inviteError),
      },
    ]);
  }, [inviteError, resetCircleInviteCode, t]);

  const add = useCallback(async (input: { name: string; email: string }) => {
    const res = await requestContactLink({ name: input.name, email: input.email });
    if (res.status === "invite_pending") {
      showAlert(t("sharing.notOnAppTitle", { name: input.name }), t("sharing.notOnAppBody"), [
        { text: t("common.later"), style: "cancel" },
        { text: t("sharing.sendInvite"), onPress: () => sendInvite(input, "email_not_found") },
      ]);
    }
  }, [requestContactLink, sendInvite, t]);

  const remove = useCallback(async (person: CirclePerson) => {
    try {
      if (person.linkId) await removeContactLink({ linkId: person.linkId as Id<"contactLinks"> });
      else if (person.inviteId) await removeInvite({ inviteId: person.inviteId as Id<"pendingInvites"> });
    } catch {
      linkError();
    }
  }, [linkError, removeContactLink, removeInvite]);

  const respond = useCallback(async (linkId: string, accept: boolean) => {
    // Accepting means receiving their SOS alerts, which arrive as push notifications.
    if (accept) void registerGroupPush(true);
    await respondToContactLink({ linkId: linkId as Id<"contactLinks">, accept }).catch(linkError);
  }, [linkError, respondToContactLink]);

  const setSeesYou = useCallback(async (userId: string, on: boolean) => {
    await setSharePaused({ recipientUserId: userId, paused: !on });
  }, [setSharePaused]);

  return { ...circle, loaded: links !== undefined, add, remove, respond, setSeesYou, sendInvite, shareInviteLink, resetInviteLink };
}
