import { v, type Infer } from "convex/values";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, mutation, type ActionCtx, type MutationCtx } from "./_generated/server";
import { assertMaxLength, isExpoPushToken, truncate } from "./securityRules";
import { requireUser } from "./users";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const NOTIFY_TITLE_CHARS = 60;
const NOTIFY_INTERVAL_MS = 60_000;
const MAX_TOKENS_PER_USER = 10;
const MAX_LOCALE = 35;

// Only new or reassigned tokens count; the legitimate case is a sign-in on a new or shared phone.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  pushTokenClaim: { kind: "token bucket", rate: 6, period: HOUR, capacity: 3 },
});
const PUSH_CHUNK = 100;
// Must match the Android channel and `data.source` the app registers for group updates.
const CHANNEL_ID = "trip-updates";
const SOURCE = "nomadsafe-trip";

type Template = {
  added: string;
  updated: string;
  deleted: string;
  paid: string;
  paymentRemoved: string;
  many: string;
};

// Placeholders: {actor}, {title}, {amount}, {count}.
const TEMPLATES: Record<string, Template> = {
  en: { added: "{actor} added {title} · {amount}", updated: "{actor} updated {title}", deleted: "{actor} deleted {title}", paid: "{actor} recorded a payment · {amount}", paymentRemoved: "{actor} removed a payment", many: "{actor} made {count} changes to the expenses" },
  ar: { added: "أضاف {actor} {title} · {amount}", updated: "عدّل {actor} {title}", deleted: "حذف {actor} {title}", paid: "سجّل {actor} دفعة · {amount}", paymentRemoved: "أزال {actor} دفعة", many: "أجرى {actor} {count} تغييرات على النفقات" },
  de: { added: "{actor} hat {title} hinzugefügt · {amount}", updated: "{actor} hat {title} geändert", deleted: "{actor} hat {title} gelöscht", paid: "{actor} hat eine Zahlung erfasst · {amount}", paymentRemoved: "{actor} hat eine Zahlung entfernt", many: "{actor} hat {count} Änderungen an den Ausgaben vorgenommen" },
  es: { added: "{actor} añadió {title} · {amount}", updated: "{actor} actualizó {title}", deleted: "{actor} eliminó {title}", paid: "{actor} registró un pago · {amount}", paymentRemoved: "{actor} eliminó un pago", many: "{actor} hizo {count} cambios en los gastos" },
  fr: { added: "{actor} a ajouté {title} · {amount}", updated: "{actor} a modifié {title}", deleted: "{actor} a supprimé {title}", paid: "{actor} a enregistré un paiement · {amount}", paymentRemoved: "{actor} a supprimé un paiement", many: "{actor} a fait {count} modifications dans les dépenses" },
  hi: { added: "{actor} ने {title} जोड़ा · {amount}", updated: "{actor} ने {title} बदला", deleted: "{actor} ने {title} हटाया", paid: "{actor} ने भुगतान दर्ज किया · {amount}", paymentRemoved: "{actor} ने एक भुगतान हटाया", many: "{actor} ने खर्चों में {count} बदलाव किए" },
  it: { added: "{actor} ha aggiunto {title} · {amount}", updated: "{actor} ha modificato {title}", deleted: "{actor} ha eliminato {title}", paid: "{actor} ha registrato un pagamento · {amount}", paymentRemoved: "{actor} ha rimosso un pagamento", many: "{actor} ha fatto {count} modifiche alle spese" },
  ja: { added: "{actor}が{title}を追加 · {amount}", updated: "{actor}が{title}を更新", deleted: "{actor}が{title}を削除", paid: "{actor}が支払いを記録 · {amount}", paymentRemoved: "{actor}が支払いを削除", many: "{actor}が支出を{count}件変更しました" },
  kn: { added: "{actor} {title} ಸೇರಿಸಿದರು · {amount}", updated: "{actor} {title} ನವೀಕರಿಸಿದರು", deleted: "{actor} {title} ಅಳಿಸಿದರು", paid: "{actor} ಪಾವತಿ ದಾಖಲಿಸಿದರು · {amount}", paymentRemoved: "{actor} ಒಂದು ಪಾವತಿ ತೆಗೆದರು", many: "{actor} ಖರ್ಚುಗಳಲ್ಲಿ {count} ಬದಲಾವಣೆ ಮಾಡಿದರು" },
  ko: { added: "{actor}님이 {title} 추가 · {amount}", updated: "{actor}님이 {title} 수정", deleted: "{actor}님이 {title} 삭제", paid: "{actor}님이 결제를 기록 · {amount}", paymentRemoved: "{actor}님이 결제를 삭제", many: "{actor}님이 지출을 {count}건 변경했어요" },
  ml: { added: "{actor} {title} ചേർത്തു · {amount}", updated: "{actor} {title} പുതുക്കി", deleted: "{actor} {title} ഇല്ലാതാക്കി", paid: "{actor} ഒരു പേയ്‌മെന്റ് രേഖപ്പെടുത്തി · {amount}", paymentRemoved: "{actor} ഒരു പേയ്‌മെന്റ് നീക്കി", many: "{actor} ചെലവുകളിൽ {count} മാറ്റങ്ങൾ വരുത്തി" },
  "pt-BR": { added: "{actor} adicionou {title} · {amount}", updated: "{actor} atualizou {title}", deleted: "{actor} excluiu {title}", paid: "{actor} registrou um pagamento · {amount}", paymentRemoved: "{actor} removeu um pagamento", many: "{actor} fez {count} alterações nas despesas" },
  ta: { added: "{actor} {title} சேர்த்தார் · {amount}", updated: "{actor} {title} புதுப்பித்தார்", deleted: "{actor} {title} நீக்கினார்", paid: "{actor} ஒரு கட்டணத்தைப் பதிவு செய்தார் · {amount}", paymentRemoved: "{actor} ஒரு கட்டணத்தை நீக்கினார்", many: "{actor} செலவுகளில் {count} மாற்றங்கள் செய்தார்" },
  te: { added: "{actor} {title} జోడించారు · {amount}", updated: "{actor} {title} అప్‌డేట్ చేశారు", deleted: "{actor} {title} తొలగించారు", paid: "{actor} చెల్లింపును నమోదు చేశారు · {amount}", paymentRemoved: "{actor} ఒక చెల్లింపును తీసివేశారు", many: "{actor} ఖర్చుల్లో {count} మార్పులు చేశారు" },
  "zh-CN": { added: "{actor} 添加了 {title} · {amount}", updated: "{actor} 更新了 {title}", deleted: "{actor} 删除了 {title}", paid: "{actor} 记录了一笔付款 · {amount}", paymentRemoved: "{actor} 删除了一笔付款", many: "{actor} 对支出做了 {count} 处更改" },
};

// Placeholders: {actor}, {title}.
const TICKET_ASK: Record<string, string> = {
  en: "{actor} needs the ticket for {title}. Tap to send it.",
  ar: "{actor} يحتاج تذكرة {title}. اضغط لإرسالها.",
  de: "{actor} braucht das Ticket für {title}. Tippe, um es zu senden.",
  es: "{actor} necesita el billete de {title}. Toca para enviarlo.",
  fr: "{actor} a besoin du billet pour {title}. Touchez pour l'envoyer.",
  hi: "{actor} को {title} का टिकट चाहिए। भेजने के लिए टैप करें।",
  it: "{actor} ha bisogno del biglietto per {title}. Tocca per inviarlo.",
  ja: "{actor}さんが{title}のチケットを必要としています。タップして送信。",
  kn: "{actor} ಅವರಿಗೆ {title} ಟಿಕೆಟ್ ಬೇಕು. ಕಳುಹಿಸಲು ಟ್ಯಾಪ್ ಮಾಡಿ.",
  ko: "{actor}님이 {title} 티켓이 필요해요. 탭해서 보내세요.",
  ml: "{actor} ന് {title} ടിക്കറ്റ് വേണം. അയയ്ക്കാൻ ടാപ്പ് ചെയ്യുക.",
  "pt-BR": "{actor} precisa do ingresso de {title}. Toque para enviar.",
  ta: "{actor} க்கு {title} டிக்கெட் தேவை. அனுப்ப தட்டவும்.",
  te: "{actor} కి {title} టికెట్ కావాలి. పంపడానికి నొక్కండి.",
  "zh-CN": "{actor} 需要 {title} 的票据。点按即可发送。",
};

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

function formatAmount(amount: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount} ${currency}`.trim();
  }
}

/** Registers this device's Expo push token for the signed-in user. */
export const savePushToken = mutation({
  args: { token: v.string(), locale: v.string() },
  handler: async (ctx, { token, locale }) => {
    const user = await requireUser(ctx);
    if (!isExpoPushToken(token)) throw new Error("Invalid push token");
    assertMaxLength(locale, MAX_LOCALE, "Locale");
    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (existing?.userId === user.id) {
      await ctx.db.patch(existing._id, { locale, updatedAt: Date.now() });
      return;
    }
    // A token held by another account moves to the caller: one phone, whoever signed in last. Tokens
    // are never readable by clients, and the claim limit keeps anyone from cycling through guesses.
    await rateLimiter.limit(ctx, "pushTokenClaim", { key: user.id, throws: true });
    if (existing) await ctx.db.patch(existing._id, { userId: user.id, locale, updatedAt: Date.now() });
    else await ctx.db.insert("pushTokens", { userId: user.id, token, locale, updatedAt: Date.now() });

    const tokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", user.id))
      .collect();
    const oldestFirst = tokens.sort((a, b) => a.updatedAt - b.updatedAt);
    for (const stale of oldestFirst.slice(0, Math.max(0, tokens.length - MAX_TOKENS_PER_USER))) await ctx.db.delete(stale._id);
  },
});

/** Called on sign-out so this device stops receiving the account's notifications. */
export const removePushToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx);
    if (token.length > 200) return;
    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (existing && existing.userId === user.id) await ctx.db.delete(existing._id);
  },
});

export const deleteTokens = internalMutation({
  args: { tokens: v.array(v.string()) },
  handler: async (ctx, { tokens }) => {
    for (const token of tokens) {
      const existing = await ctx.db
        .query("pushTokens")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
      if (existing) await ctx.db.delete(existing._id);
    }
  },
});

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  channelId: string;
  priority?: "high";
  data: Record<string, string>;
};

type PushTicket = { status: string; details?: { error?: string } };

const PUSH_RETRY_DELAY_MS = 1_000;

/** Posts one chunk to Expo, retrying once after a short pause on 429, 5xx or a network error. */
async function postPushChunk(chunk: PushMessage[]): Promise<PushTicket[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, PUSH_RETRY_DELAY_MS));
    let res: Response;
    try {
      res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          // With Expo's enhanced push security on, only requests carrying this token are accepted.
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk),
      });
    } catch (err) {
      console.error(`Expo push request failed (attempt ${attempt + 1})`, err);
      continue;
    }
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { data?: PushTicket[]; errors?: unknown } | null;
      if (body?.errors) console.error("Expo push returned errors", JSON.stringify(body.errors));
      return body?.data ?? null;
    }
    console.error(`Expo push returned HTTP ${res.status} (attempt ${attempt + 1})`, (await res.text().catch(() => "")).slice(0, 500));
    if (res.status !== 429 && res.status < 500) return null;
  }
  return null;
}

/** Sends Expo pushes in chunks and drops tokens Expo reports as no longer registered. Best-effort. */
export async function sendPushMessages(ctx: ActionCtx, messages: PushMessage[]) {
  const gone: string[] = [];
  for (let i = 0; i < messages.length; i += PUSH_CHUNK) {
    const chunk = messages.slice(i, i + PUSH_CHUNK);
    const tickets = await postPushChunk(chunk);
    tickets?.forEach((ticket, index) => {
      if (ticket.status !== "error") return;
      if (ticket.details?.error === "DeviceNotRegistered") gone.push(chunk[index].to);
      else console.error("Expo push ticket error", ticket.details?.error ?? "unknown");
    });
  }
  if (gone.length > 0) await ctx.runMutation(internal.pushNotifications.deleteTokens, { tokens: gone });
}

const changeValidator = v.object({
  kind: v.union(v.literal("expense"), v.literal("settlement")),
  action: v.union(v.literal("added"), v.literal("updated"), v.literal("deleted")),
  title: v.string(),
  amount: v.number(),
  currency: v.string(),
});

type Change = Infer<typeof changeValidator>;

/**
 * Sends a member's money changes right away, or, within a minute of their last push on this group,
 * counts them and sends one summary when the minute is up, so a burst of edits is one notification.
 */
export async function queueGroupNotification(ctx: MutationCtx, groupId: Id<"sharedGroups">, actorMemberId: string, changes: Change[]) {
  const now = Date.now();
  const state = await ctx.db
    .query("groupNotifyState")
    .withIndex("by_group_actor", (q) => q.eq("groupId", groupId).eq("actorMemberId", actorMemberId))
    .unique();
  if (!state || (!state.flushScheduled && now - state.lastSentAt >= NOTIFY_INTERVAL_MS)) {
    await ctx.scheduler.runAfter(0, internal.pushNotifications.notifyGroup, {
      groupId,
      actorMemberId,
      changes: changes.slice(0, 1),
      count: changes.length,
    });
    if (state) await ctx.db.patch(state._id, { lastSentAt: now, pendingCount: 0, pendingFirst: undefined });
    else await ctx.db.insert("groupNotifyState", { groupId, actorMemberId, lastSentAt: now, pendingCount: 0, flushScheduled: false });
    return;
  }
  await ctx.db.patch(state._id, {
    pendingCount: state.pendingCount + changes.length,
    pendingFirst: state.pendingFirst ?? changes[0],
    flushScheduled: true,
  });
  if (!state.flushScheduled) {
    await ctx.scheduler.runAt(state.lastSentAt + NOTIFY_INTERVAL_MS, internal.pushNotifications.flushGroupNotification, {
      stateId: state._id,
    });
  }
}

export const flushGroupNotification = internalMutation({
  args: { stateId: v.id("groupNotifyState") },
  handler: async (ctx, { stateId }) => {
    const state = await ctx.db.get(stateId);
    if (!state) return;
    if (state.pendingCount > 0 && state.pendingFirst) {
      await ctx.scheduler.runAfter(0, internal.pushNotifications.notifyGroup, {
        groupId: state.groupId,
        actorMemberId: state.actorMemberId,
        changes: [state.pendingFirst],
        count: state.pendingCount,
      });
    }
    await ctx.db.patch(stateId, { lastSentAt: Date.now(), pendingCount: 0, pendingFirst: undefined, flushScheduled: false });
  },
});

/** Sends one notification per device about a member's money changes; drops tokens Expo reports as gone. */
export const notifyGroup = internalAction({
  // `count` is how many changes `changes[0]` stands for; older scheduled jobs pass every change instead.
  args: { groupId: v.id("sharedGroups"), actorMemberId: v.string(), changes: v.array(changeValidator), count: v.optional(v.number()) },
  handler: async (ctx, { groupId, actorMemberId, changes, count }) => {
    const info = await ctx.runQuery(internal.groups.notificationTargets, { groupId, actorMemberId });
    if (!info || info.targets.length === 0 || changes.length === 0) return;
    const total = count ?? changes.length;

    const messages = info.targets.map(({ token, locale }) => {
      const t = TEMPLATES[locale] ?? TEMPLATES[locale.split("-")[0]] ?? TEMPLATES.en;
      const change = changes[0];
      const values = {
        actor: truncate(info.actorName, NOTIFY_TITLE_CHARS),
        title: truncate(change.title, NOTIFY_TITLE_CHARS),
        amount: formatAmount(change.amount, change.currency, locale),
        count: String(total),
      };
      const template =
        total > 1
          ? t.many
          : change.kind === "settlement"
            ? change.action === "deleted"
              ? t.paymentRemoved
              : t.paid
            : t[change.action];
      return {
        to: token,
        title: truncate(info.groupName, NOTIFY_TITLE_CHARS),
        body: fill(template, values),
        sound: "default" as const,
        channelId: CHANNEL_ID,
        data: { source: SOURCE, groupId: String(groupId) },
      };
    });

    await sendPushMessages(ctx, messages);
  },
});

/** Asks the members holding an item's ticket to send it; tapping opens the ticket with Send ready. */
export const notifyTicketAsk = internalAction({
  args: { groupId: v.id("sharedGroups"), askerMemberId: v.string(), holderMemberIds: v.array(v.string()), clientId: v.string(), title: v.string() },
  handler: async (ctx, { groupId, askerMemberId, holderMemberIds, clientId, title }) => {
    const info = await ctx.runQuery(internal.groups.memberPushTargets, { groupId, memberIds: holderMemberIds, actorMemberId: askerMemberId });
    if (!info || info.targets.length === 0) return;
    const messages = info.targets.map(({ token, locale }) => ({
      to: token,
      title: truncate(info.groupName, NOTIFY_TITLE_CHARS),
      body: fill(TICKET_ASK[locale] ?? TICKET_ASK[locale.split("-")[0]] ?? TICKET_ASK.en, {
        actor: truncate(info.actorName, NOTIFY_TITLE_CHARS),
        title: truncate(title, NOTIFY_TITLE_CHARS),
      }),
      sound: "default" as const,
      channelId: CHANNEL_ID,
      data: { source: SOURCE, groupId: String(groupId), type: "ticket_ask", eventId: clientId },
    }));
    await sendPushMessages(ctx, messages);
  },
});
