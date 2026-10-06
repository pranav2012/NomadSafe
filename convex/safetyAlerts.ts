import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { sendPushMessages, type PushMessage } from "./pushNotifications";
import { findAuthUserById, requireUser } from "./users";

// Must match SAFETY_ALERT_CHANNEL_ID, SAFETY_NOTIFICATION_SOURCE and SOS_ROUTE in the app.
const CHANNEL_ID = "safety-alerts";
const SOURCE = "nomadsafe-safety";
const SOS_ROUTE = "/(tabs)/sos";

// Contacts are alerted this long after a missed check-in, so the user's own reminder comes first.
const CHECK_IN_GRACE_MS = 5 * 60_000;
const MAX_CHECK_IN_MS = 48 * 60 * 60_000;
const SOS_REPEAT_MS = 60_000;

type AlertKind = "sos" | "missedCheckIn" | "safe";
type Template = Record<AlertKind, { title: string; body: string }>;

// No locations in push text; contacts see them in the app.
const TEMPLATES: Record<string, Template> = {
  en: {
    sos: { title: "{name} needs help", body: "{name} triggered SOS. Open NomadSafe to see where they are." },
    missedCheckIn: { title: "{name} missed a check-in", body: "{name} didn't check in on time. Try to reach them now." },
    safe: { title: "{name} is safe", body: "{name} marked themselves safe in NomadSafe." },
  },
  ar: {
    sos: { title: "{name} يحتاج إلى مساعدة", body: "فعّل {name} نداء الاستغاثة. افتح NomadSafe لمعرفة مكانه." },
    missedCheckIn: { title: "فات {name} تسجيل الوصول", body: "لم يسجّل {name} وصوله في الوقت المحدد. حاول التواصل معه الآن." },
    safe: { title: "{name} بأمان", body: "أكّد {name} أنه بأمان في NomadSafe." },
  },
  de: {
    sos: { title: "{name} braucht Hilfe", body: "{name} hat SOS ausgelöst. Öffne NomadSafe, um den Standort zu sehen." },
    missedCheckIn: { title: "{name} hat einen Check-in verpasst", body: "{name} hat sich nicht rechtzeitig gemeldet. Versuche jetzt, die Person zu erreichen." },
    safe: { title: "{name} ist in Sicherheit", body: "{name} hat sich in NomadSafe als sicher gemeldet." },
  },
  es: {
    sos: { title: "{name} necesita ayuda", body: "{name} activó el SOS. Abre NomadSafe para ver dónde está." },
    missedCheckIn: { title: "{name} no hizo su check-in", body: "{name} no confirmó a tiempo. Intenta contactar ahora." },
    safe: { title: "{name} está a salvo", body: "{name} indicó en NomadSafe que está bien." },
  },
  fr: {
    sos: { title: "{name} a besoin d'aide", body: "{name} a déclenché un SOS. Ouvrez NomadSafe pour voir sa position." },
    missedCheckIn: { title: "{name} a manqué un check-in", body: "{name} ne s'est pas manifesté à temps. Essayez de le joindre maintenant." },
    safe: { title: "{name} est en sécurité", body: "{name} a indiqué dans NomadSafe qu'il va bien." },
  },
  hi: {
    sos: { title: "{name} को मदद चाहिए", body: "{name} ने SOS चालू किया है। उनकी लोकेशन देखने के लिए NomadSafe खोलें।" },
    missedCheckIn: { title: "{name} का चेक-इन छूट गया", body: "{name} ने समय पर चेक-इन नहीं किया। अभी उनसे संपर्क करने की कोशिश करें।" },
    safe: { title: "{name} सुरक्षित हैं", body: "{name} ने NomadSafe में खुद को सुरक्षित बताया है।" },
  },
  it: {
    sos: { title: "{name} ha bisogno di aiuto", body: "{name} ha attivato l'SOS. Apri NomadSafe per vedere dove si trova." },
    missedCheckIn: { title: "{name} ha saltato un check-in", body: "{name} non ha fatto il check-in in tempo. Prova a contattarlo ora." },
    safe: { title: "{name} è al sicuro", body: "{name} ha segnalato su NomadSafe di stare bene." },
  },
  ja: {
    sos: { title: "{name}さんが助けを求めています", body: "{name}さんがSOSを発信しました。NomadSafeを開いて居場所を確認してください。" },
    missedCheckIn: { title: "{name}さんのチェックインがありません", body: "{name}さんが時間内にチェックインしませんでした。今すぐ連絡してみてください。" },
    safe: { title: "{name}さんは無事です", body: "{name}さんがNomadSafeで無事を知らせました。" },
  },
  kn: {
    sos: { title: "{name} ಅವರಿಗೆ ಸಹಾಯ ಬೇಕು", body: "{name} SOS ಆರಂಭಿಸಿದ್ದಾರೆ. ಅವರು ಎಲ್ಲಿದ್ದಾರೆ ಎಂದು ನೋಡಲು NomadSafe ತೆರೆಯಿರಿ." },
    missedCheckIn: { title: "{name} ಚೆಕ್-ಇನ್ ತಪ್ಪಿಸಿದ್ದಾರೆ", body: "{name} ಸಮಯಕ್ಕೆ ಚೆಕ್-ಇನ್ ಮಾಡಲಿಲ್ಲ. ಈಗಲೇ ಅವರನ್ನು ಸಂಪರ್ಕಿಸಲು ಪ್ರಯತ್ನಿಸಿ." },
    safe: { title: "{name} ಸುರಕ್ಷಿತರಾಗಿದ್ದಾರೆ", body: "{name} NomadSafe ನಲ್ಲಿ ತಾವು ಸುರಕ್ಷಿತ ಎಂದು ತಿಳಿಸಿದ್ದಾರೆ." },
  },
  ko: {
    sos: { title: "{name}님이 도움이 필요해요", body: "{name}님이 SOS를 보냈어요. NomadSafe를 열어 위치를 확인하세요." },
    missedCheckIn: { title: "{name}님이 체크인하지 않았어요", body: "{name}님이 제시간에 체크인하지 않았어요. 지금 연락해 보세요." },
    safe: { title: "{name}님은 안전해요", body: "{name}님이 NomadSafe에서 안전하다고 알렸어요." },
  },
  ml: {
    sos: { title: "{name}ന് സഹായം വേണം", body: "{name} SOS ആരംഭിച്ചു. അവർ എവിടെയാണെന്ന് കാണാൻ NomadSafe തുറക്കുക." },
    missedCheckIn: { title: "{name} ചെക്ക് ഇൻ ചെയ്തില്ല", body: "{name} സമയത്ത് ചെക്ക് ഇൻ ചെയ്തില്ല. ഇപ്പോൾ അവരെ ബന്ധപ്പെടാൻ ശ്രമിക്കുക." },
    safe: { title: "{name} സുരക്ഷിതരാണ്", body: "{name} NomadSafe-ൽ സുരക്ഷിതരാണെന്ന് അറിയിച്ചു." },
  },
  "pt-BR": {
    sos: { title: "{name} precisa de ajuda", body: "{name} acionou o SOS. Abra o NomadSafe para ver onde a pessoa está." },
    missedCheckIn: { title: "{name} perdeu um check-in", body: "{name} não fez o check-in a tempo. Tente falar com a pessoa agora." },
    safe: { title: "{name} está bem", body: "{name} avisou no NomadSafe que está bem." },
  },
  ta: {
    sos: { title: "{name}க்கு உதவி தேவை", body: "{name} SOS அனுப்பியுள்ளார். அவர் எங்கே இருக்கிறார் என்று பார்க்க NomadSafe-ஐத் திறக்கவும்." },
    missedCheckIn: { title: "{name} செக்-இன் செய்யவில்லை", body: "{name} நேரத்திற்குள் செக்-இன் செய்யவில்லை. இப்போதே அவரைத் தொடர்புகொள்ள முயலுங்கள்." },
    safe: { title: "{name} பாதுகாப்பாக உள்ளார்", body: "{name} NomadSafe-இல் தான் பாதுகாப்பாக இருப்பதாகத் தெரிவித்துள்ளார்." },
  },
  te: {
    sos: { title: "{name}కి సహాయం కావాలి", body: "{name} SOS పంపారు. వారు ఎక్కడ ఉన్నారో చూడటానికి NomadSafe తెరవండి." },
    missedCheckIn: { title: "{name} చెక్-ఇన్ చేయలేదు", body: "{name} సమయానికి చెక్-ఇన్ చేయలేదు. ఇప్పుడే వారిని సంప్రదించడానికి ప్రయత్నించండి." },
    safe: { title: "{name} సురక్షితంగా ఉన్నారు", body: "{name} NomadSafe‌లో తాము సురక్షితంగా ఉన్నామని తెలిపారు." },
  },
  "zh-CN": {
    sos: { title: "{name} 需要帮助", body: "{name} 发出了 SOS。打开 NomadSafe 查看对方位置。" },
    missedCheckIn: { title: "{name} 错过了签到", body: "{name} 没有按时签到。请立即尝试联系对方。" },
    safe: { title: "{name} 很安全", body: "{name} 已在 NomadSafe 中报平安。" },
  },
};

function fill(template: string, name: string) {
  return template.replace(/\{name\}/g, name);
}

async function getRow(ctx: MutationCtx, userId: string) {
  return ctx.db
    .query("safetyAlerts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function upsertRow(ctx: MutationCtx, userId: string, row: Doc<"safetyAlerts"> | null, patch: Partial<Doc<"safetyAlerts">>) {
  if (row) await ctx.db.patch(row._id, patch);
  else await ctx.db.insert("safetyAlerts", { userId, ...patch });
}

/** Linked contacts that can actually get a push (at least one registered device). */
async function countRecipients(ctx: MutationCtx, userId: string) {
  const links = await ctx.db
    .query("contactLinks")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .filter((q) => q.eq(q.field("status"), "accepted"))
    .collect();
  let count = 0;
  for (const link of links) {
    const token = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", link.linkedUserId))
      .first();
    if (token) count++;
  }
  return count;
}

/** Sets or clears the check-in deadline; moving or clearing it after an alert tells contacts the user is safe. */
export const setCheckIn = mutation({
  args: { endsAt: v.union(v.number(), v.null()) },
  handler: async (ctx, { endsAt }) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    if (endsAt !== null && (!Number.isFinite(endsAt) || endsAt > now + MAX_CHECK_IN_MS)) {
      throw new Error("Invalid check-in time");
    }
    const row = await getRow(ctx, user.id);
    if (row?.checkInJob) await ctx.scheduler.cancel(row.checkInJob);

    const wasAlerted = row?.activeAlert === "missedCheckIn";
    if (wasAlerted) await ctx.scheduler.runAfter(0, internal.safetyAlerts.notifyContacts, { userId: user.id, kind: "safe" });

    if (endsAt === null) {
      await upsertRow(ctx, user.id, row, {
        checkInEndsAt: undefined,
        checkInJob: undefined,
        activeAlert: wasAlerted ? undefined : row?.activeAlert,
      });
      return { recipients: 0 };
    }
    const job = await ctx.scheduler.runAt(Math.max(endsAt, now) + CHECK_IN_GRACE_MS, internal.safetyAlerts.checkInDeadline, {
      userId: user.id,
      endsAt,
    });
    await upsertRow(ctx, user.id, row, {
      checkInEndsAt: endsAt,
      checkInJob: job,
      activeAlert: wasAlerted ? undefined : row?.activeAlert,
    });
    return { recipients: await countRecipients(ctx, user.id), alertAt: Math.max(endsAt, now) + CHECK_IN_GRACE_MS };
  },
});

export const checkInDeadline = internalMutation({
  args: { userId: v.string(), endsAt: v.number() },
  handler: async (ctx, { userId, endsAt }) => {
    const row = await getRow(ctx, userId);
    if (!row || row.checkInEndsAt !== endsAt) return;
    await ctx.db.patch(row._id, { checkInEndsAt: undefined, checkInJob: undefined, activeAlert: "missedCheckIn" });
    await ctx.scheduler.runAfter(0, internal.safetyAlerts.notifyContacts, { userId, kind: "missedCheckIn" });
  },
});

/** Alerts the user's linked contacts that they triggered SOS. Returns how many contacts can get the push. */
export const triggerSos = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    const row = await getRow(ctx, user.id);
    const recipients = await countRecipients(ctx, user.id);
    if (row?.activeAlert === "sos" && row.lastSosAt && now - row.lastSosAt < SOS_REPEAT_MS) return { recipients };
    if (row?.checkInJob) await ctx.scheduler.cancel(row.checkInJob);
    await upsertRow(ctx, user.id, row, { activeAlert: "sos", lastSosAt: now, checkInEndsAt: undefined, checkInJob: undefined });
    await ctx.scheduler.runAfter(0, internal.safetyAlerts.notifyContacts, { userId: user.id, kind: "sos" });
    return { recipients };
  },
});

/** Ends an SOS; contacts who were alerted hear that the user is safe. */
export const resolveSos = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const row = await getRow(ctx, user.id);
    if (row?.activeAlert !== "sos") return;
    await ctx.db.patch(row._id, { activeAlert: undefined });
    await ctx.scheduler.runAfter(0, internal.safetyAlerts.notifyContacts, { userId: user.id, kind: "safe" });
  },
});

/** Push tokens of everyone who accepted the user's live-location link. */
export const alertTargets = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const links = await ctx.db
      .query("contactLinks")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .filter((q) => q.eq(q.field("status"), "accepted"))
      .collect();
    const targets: { token: string; locale: string }[] = [];
    for (const link of links) {
      const tokens = await ctx.db
        .query("pushTokens")
        .withIndex("by_user", (q) => q.eq("userId", link.linkedUserId))
        .collect();
      targets.push(...tokens.map((token) => ({ token: token.token, locale: token.locale })));
    }
    const owner = await findAuthUserById(ctx, userId);
    return { name: owner?.name || owner?.email || "", targets };
  },
});

export const notifyContacts = internalAction({
  args: { userId: v.string(), kind: v.union(v.literal("sos"), v.literal("missedCheckIn"), v.literal("safe")) },
  handler: async (ctx, { userId, kind }) => {
    const { name, targets } = await ctx.runQuery(internal.safetyAlerts.alertTargets, { userId });
    if (targets.length === 0) return;
    const messages: PushMessage[] = targets.map(({ token, locale }) => {
      const template = (TEMPLATES[locale] ?? TEMPLATES[locale.split("-")[0]] ?? TEMPLATES.en)[kind];
      return {
        to: token,
        title: fill(template.title, name),
        body: fill(template.body, name),
        sound: "default",
        priority: "high",
        channelId: CHANNEL_ID,
        data: { source: SOURCE, url: SOS_ROUTE, kind: `contact-${kind}` },
      };
    });
    await sendPushMessages(ctx, messages);
  },
});

/** Removes the user's safety row and cancels a pending check-in alert (account deletion). */
export async function deleteSafetyAlerts(ctx: MutationCtx, userId: string) {
  const row = await getRow(ctx, userId);
  if (!row) return;
  if (row.checkInJob) await ctx.scheduler.cancel(row.checkInJob);
  await ctx.db.delete(row._id);
}
