import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, type ActionCtx } from "./_generated/server";
import { requireUser } from "./users";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const PUSH_CHUNK = 100;
// Must match the Android channel and `data.source` the app registers for trip updates.
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
    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { userId: user.id, locale, updatedAt: Date.now() });
    else await ctx.db.insert("pushTokens", { userId: user.id, token, locale, updatedAt: Date.now() });
  },
});

/** Called on sign-out so this device stops receiving the account's notifications. */
export const removePushToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx);
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

/** Sends Expo pushes in chunks and drops tokens Expo reports as no longer registered. Best-effort. */
export async function sendPushMessages(ctx: ActionCtx, messages: PushMessage[]) {
  const gone: string[] = [];
  for (let i = 0; i < messages.length; i += PUSH_CHUNK) {
    const chunk = messages.slice(i, i + PUSH_CHUNK);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(chunk),
      });
      const body = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
      body?.data?.forEach((ticket, index) => {
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") gone.push(chunk[index].to);
      });
    } catch {
      // Best-effort: recipients still see the change next time they open the app.
    }
  }
  if (gone.length > 0) await ctx.runMutation(internal.tripNotifications.deleteTokens, { tokens: gone });
}

const changeValidator = v.object({
  kind: v.union(v.literal("expense"), v.literal("settlement")),
  action: v.union(v.literal("added"), v.literal("updated"), v.literal("deleted")),
  title: v.string(),
  amount: v.number(),
  currency: v.string(),
});

/** Sends one notification per device about a member's money changes; drops tokens Expo reports as gone. */
export const notifyTrip = internalAction({
  args: { tripId: v.id("sharedTrips"), actorMemberId: v.string(), changes: v.array(changeValidator) },
  handler: async (ctx, { tripId, actorMemberId, changes }) => {
    const info = await ctx.runQuery(internal.groupTrips.notificationTargets, { tripId, actorMemberId });
    if (!info || info.targets.length === 0 || changes.length === 0) return;

    const messages = info.targets.map(({ token, locale }) => {
      const t = TEMPLATES[locale] ?? TEMPLATES[locale.split("-")[0]] ?? TEMPLATES.en;
      const change = changes[0];
      const values = {
        actor: info.actorName,
        title: change.title,
        amount: formatAmount(change.amount, change.currency, locale),
        count: String(changes.length),
      };
      const template =
        changes.length > 1
          ? t.many
          : change.kind === "settlement"
            ? change.action === "deleted"
              ? t.paymentRemoved
              : t.paid
            : t[change.action];
      return {
        to: token,
        title: info.tripName,
        body: fill(template, values),
        sound: "default" as const,
        channelId: CHANNEL_ID,
        data: { source: SOURCE, tripId: String(tripId) },
      };
    });

    await sendPushMessages(ctx, messages);
  },
});
