// Каждое утро в 07:00 по Кишинёву — список заказов на сегодня в Telegram.
// Cron в UTC: 04:00 и 05:00. Летом 7:00 = 04:00 UTC, зимой 7:00 = 05:00 UTC.
// Отправляем только в тот запуск, когда в Кишинёве ровно 7 часов, — без дублей при смене времени.
import { localParts, runReport, sendTelegram } from "../lib/morning-core.mjs";

export default async () => {
  const { hour } = localParts();
  if (hour !== 7) return new Response("skip: local hour " + hour);
  try {
    await runReport(true);
    return new Response("sent");
  } catch (e) {
    try { await sendTelegram("⚠️ Утреннее напоминание о заказах не сработало: " + (e && e.message)); } catch (e2) {}
    return new Response("error: " + (e && e.message), { status: 500 });
  }
};

export const config = { schedule: "0 4,5 * * *" };
