import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Share } from "react-native";
import { api, type Id, useMutation, useQuery } from "@/modules/backend";
import { showAlert } from "@/atoms";
import { registerTripPush } from "@/features/sync";
import { useLocalization } from "@/localization";
import { buildCircle, type Circle, type CirclePerson, type IncomingShareInput } from "../utils/circle";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.pranav.nomadsafe";
const EMPTY = { outgoing: [], incoming: [], invites: [] };

type ContactLinks = {
  outgoing: { id: Id<"contactLinks">; linkedUserId: string; name: string; email: string; status: "pending" | "accepted" | "declined" }[];
  incoming: { id: Id<"contactLinks">; ownerUserId: string; ownerName: string; ownerEmail: string | null; status: "pending" | "accepted" | "declined" }[];
  invites: { id: Id<"pendingInvites">; name: string; email: string | null; phone: string | null }[];
};

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
  sendInvite: (person: { name: string; email: string | null }) => void;
} {
  const { t } = useLocalization();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const links = useQuery(api.sharing.getContactLinks) as ContactLinks | undefined;
  const incomingShares = useQuery(api.sharing.getIncomingShares) as IncomingShareInput[] | undefined;
  const outgoingShares = useQuery(api.sharing.getOutgoingShares);

  const requestContactLink = useMutation(api.sharing.requestContactLink);
  const respondToContactLink = useMutation(api.sharing.respondToContactLink);
  const removeContactLink = useMutation(api.sharing.removeContactLink);
  const removeInvite = useMutation(api.sharing.removeInvite);
  const setSharePaused = useMutation(api.sharing.setSharePaused);

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

  const sendInvite = useCallback((person: { name: string; email: string | null }) => {
    const body = t("sharing.inviteMessage", { url: PLAY_STORE_URL });
    const share = () => Share.share({ message: body }).catch(() => {});
    if (!person.email) {
      void share();
      return;
    }
    Linking.openURL(
      `mailto:${person.email}?subject=${encodeURIComponent(t("sharing.inviteSubject"))}&body=${encodeURIComponent(body)}`,
    ).catch(share);
  }, [t]);

  const add = useCallback(async (input: { name: string; email: string }) => {
    const res = await requestContactLink({ name: input.name, email: input.email });
    if (res.status === "invite_pending") {
      showAlert(t("sharing.notOnAppTitle", { name: input.name }), t("sharing.notOnAppBody"), [
        { text: t("common.later"), style: "cancel" },
        { text: t("sharing.sendInvite"), onPress: () => sendInvite(input) },
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
    if (accept) void registerTripPush(true);
    await respondToContactLink({ linkId: linkId as Id<"contactLinks">, accept }).catch(linkError);
  }, [linkError, respondToContactLink]);

  const setSeesYou = useCallback(async (userId: string, on: boolean) => {
    await setSharePaused({ recipientUserId: userId, paused: !on });
  }, [setSharePaused]);

  return { ...circle, loaded: links !== undefined, add, remove, respond, setSeesYou, sendInvite };
}
