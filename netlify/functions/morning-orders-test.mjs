// Ручная проверка утреннего напоминания (этап 2: без утечки данных клиентов).
//   /.netlify/functions/morning-orders-test   — проверка: входит ли отчёт в базу и сколько заказов
//                                               с галочкой «Напомнить утром» (имена/телефоны НЕ показываются)
//   ...?send=1&key=<REPORT_TEST_KEY>          — отправить отчёт в Telegram прямо сейчас
//                                               (работает, только если в Netlify задана переменная REPORT_TEST_KEY)
import { loadOrders, runReport } from "../lib/morning-core.mjs";

export default async (req) => {
  const u = new URL(req.url);
  const send = u.searchParams.get("send") === "1";
  const key = u.searchParams.get("key") || "";
  const h = { "content-type": "text/plain; charset=utf-8" };
  try {
    if (send) {
      const need = process.env.REPORT_TEST_KEY;
      if (!need || key !== need) return new Response("Нет доступа", { status: 403, headers: h });
      const text = await runReport(true);
      return new Response("ОТПРАВЛЕНО В TELEGRAM\n\n" + text.split("\n")[0], { headers: h });
    }
    const orders = await loadOrders();
    const auth = process.env.REPORT_PASSWORD ? "вход под служебным аккаунтом" : "без входа (REPORT_PASSWORD не задан)";
    return new Response("OK: база доступна (" + auth + "). Заказов с галочкой «Напомнить утром»: " + orders.length, { headers: h });
  } catch (e) {
    return new Response("Ошибка: " + (e && e.message), { status: 500, headers: h });
  }
};
