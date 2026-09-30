// Утреннее напоминание о заказах (Telegram).
// Читает коллекцию orders через Firestore REST (только чтение), ничего в базе не меняет.
// В сообщение попадают ТОЛЬКО заказы с галочкой «Напомнить утром» (поле remind === true).

const PROJECT = "garageaquarium";
const API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyA71lBgfJ-lF_Ln1NHO--dEsgB16Pshyp4";
const TG_TOKEN = process.env.TG_TOKEN || "8516663689:AAEYNFqiN0ADvEpCMYqtIRy2J_Y80CdhO38";
const TG_CHAT = process.env.TG_CHAT || "7942111934";
export const TZ = "Europe/Chisinau";

const FIELDS = ["name", "phone", "city", "address", "items", "total", "status",
  "deliveryDate", "deliveryTime", "urgency", "delivery", "payment", "note", "remind"];
const SEP = "────────────";

// ---------- Firestore REST ----------
function val(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) {
    const vals = v.arrayValue && Array.isArray(v.arrayValue.values) ? v.arrayValue.values : [];
    return vals.map(val);
  }
  if ("mapValue" in v) {
    const o = {};
    const f = (v.mapValue && v.mapValue.fields) || {};
    for (const k of Object.keys(f)) o[k] = val(f[k]);
    return o;
  }
  return null;
}

// Читаем ТОЛЬКО заказы с галочкой remind == true (runQuery), а не всю коллекцию:
// так утренний отчёт тратит единицы чтений Firestore, а не сотни.
export async function loadOrders() {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "orders" }],
      where: { fieldFilter: { field: { fieldPath: "remind" }, op: "EQUAL", value: { booleanValue: true } } },
      select: { fields: FIELDS.map(f => ({ fieldPath: f })) },
      limit: 500
    }
  };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("Firestore " + r.status + ": " + (await r.text()).slice(0, 300));
  const j = await r.json();
  const rows = Array.isArray(j) ? j : [];
  const out = [];
  for (const row of rows) {
    const d = row && row.document;
    if (!d) continue;
    const o = {};
    const f = (d && d.fields) || {};
    for (const k of Object.keys(f)) o[k] = val(f[k]);
    out.push(o);
  }
  return out;
}

// ---------- даты (по Кишинёву) ----------
export function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const p = {};
  for (const x of parts) p[x.type] = x.value;
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
function addDays(ymd, n) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// дата доставки: "2026-09-29" (из формы) или "29.09.2026" (если вбили вручную)
function normDate(s) {
  if (typeof s !== "string") return null;
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
function dm(ymd) { const p = ymd.split("-"); return `${p[2]}.${p[1]}`; }
function weekday(ymd) {
  return new Date(ymd + "T12:00:00Z").toLocaleDateString("ru-RU", { weekday: "long", timeZone: "UTC" });
}

// ---------- текст ----------
function itemsList(it) {
  const arr = Array.isArray(it) ? it : (typeof it === "string" ? it.split(",") : []);
  return arr.map(x => String(x == null ? "" : x).replace(/^[\s✅✔☑✓]+/, "").trim())
    .filter(Boolean);
}
function money(n) { const v = Number(n); return (isFinite(v) ? Math.round(v) : 0) + " MDL"; }
function slot(t) { t = String(t || ""); return /утро/i.test(t) ? 0 : (/вечер/i.test(t) ? 2 : 1); }

function orderBlock(o, i) {
  const lines = [];
  lines.push(`${i + 1}. ⏰ ${o.deliveryTime || "время любое"}`);
  lines.push(`👤 ${o.name || "—"}${o.phone ? " · " + o.phone : ""}`);
  const addr = [o.city, o.address].filter(x => typeof x === "string" && x.trim()).join(", ");
  if (addr) lines.push(`📍 ${addr}`);
  const items = itemsList(o.items);
  if (items.length) lines.push("🛒 " + items.join("\n     "));
  const extra = [];
  if (Number(o.urgency) > 0) extra.push("⚡ срочный +" + Number(o.urgency));
  if (o.delivery === "yandex") extra.push("🚕 Yandex");
  if (o.payment) extra.push("💳 " + o.payment);
  lines.push("💰 " + money(o.total) + (extra.length ? " · " + extra.join(" · ") : ""));
  if (typeof o.note === "string" && o.note.trim()) lines.push("💬 " + o.note.trim());
  return lines.join("\n");
}

export function buildReport(orders, now = new Date()) {
  const { ymd } = localParts(now);
  const tmr = addDays(ymd, 1);
  const list = Array.isArray(orders) ? orders : [];
  const today = [], tomorrow = [], overdue = [], noDate = [];
  for (const o of list) {
    if (!o || o.status === "completed") continue;
    if (o.remind !== true) continue; // только отмеченные галочкой
    const d = normDate(o.deliveryDate);
    if (!d) { noDate.push(o); continue; }
    o._d = d;
    if (d === ymd) today.push(o);
    else if (d === tmr) tomorrow.push(o);
    else if (d < ymd) overdue.push(o);
  }
  // ничего не отмечено (или всё отмеченное на будущие дни) — сообщение не шлём
  if (!today.length && !tomorrow.length && !overdue.length && !noDate.length) return "";
  today.sort((a, b) => slot(a.deliveryTime) - slot(b.deliveryTime));
  overdue.sort((a, b) => (a._d < b._d ? 1 : -1));

  const sum = arr => arr.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const out = [];
  out.push(`☀️ Доброе утро! Сегодня ${dm(ymd)}, ${weekday(ymd)}`);
  out.push(SEP);
  if (today.length) {
    out.push(`📦 Собрать сегодня: ${today.length} заказ(ов) на ${money(sum(today))}`);
    out.push("");
    today.forEach((o, i) => { out.push(orderBlock(o, i)); out.push(""); });
  } else {
    out.push("📦 На сегодня отмеченных заказов нет.");
    out.push("");
  }
  if (overdue.length) {
    out.push(SEP);
    out.push(`⚠️ Дата прошла, но заказ не завершён: ${overdue.length}`);
    overdue.slice(0, 10).forEach(o => out.push(`• ${dm(o._d)} ${o.name || "—"} · ${money(o.total)}`));
    if (overdue.length > 10) out.push(`… и ещё ${overdue.length - 10}`);
    out.push("");
  }
  if (tomorrow.length) {
    out.push(SEP);
    out.push(`📅 Завтра (${dm(tmr)}): ${tomorrow.length} заказ(ов) на ${money(sum(tomorrow))}`);
    tomorrow.sort((a, b) => slot(a.deliveryTime) - slot(b.deliveryTime))
      .forEach(o => out.push(`• ${o.deliveryTime || "любое"} — ${o.name || "—"} · ${money(o.total)}`));
    out.push("");
  }
  if (noDate.length) {
    out.push(SEP);
    out.push(`🔔 Отмечены, но без даты доставки: ${noDate.length}`);
    noDate.slice(0, 10).forEach(o => out.push(`• ${o.deliveryTime ? o.deliveryTime + " — " : ""}${o.name || "—"}${o.phone ? " · " + o.phone : ""} · ${money(o.total)}`));
    if (noDate.length > 10) out.push(`… и ещё ${noDate.length - 10}`);
  }
  return out.join("\n").trim();
}

// ---------- Telegram ----------
function chunks(text, max = 3800) {
  const res = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if ((cur + "\n" + line).length > max && cur) { res.push(cur); cur = line; }
    else cur = cur ? cur + "\n" + line : line;
  }
  if (cur) res.push(cur);
  return res;
}
export async function sendTelegram(text) {
  for (const part of chunks(text)) {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text: part })
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error("Telegram: " + (j.description || r.status));
  }
}

// полный цикл: загрузить заказы → собрать текст → (по желанию) отправить
export async function runReport(send) {
  const text = buildReport(await loadOrders());
  if (!text) return "(нет заказов с галочкой «Напомнить утром» на сегодня/завтра/просроченных — сообщение не отправляется)";
  if (send) await sendTelegram(text);
  return text;
}
