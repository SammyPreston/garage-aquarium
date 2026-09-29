// Ручная проверка утреннего напоминания.
//   /.netlify/functions/morning-orders-test          — показать текст (ничего не отправляет)
//   /.netlify/functions/morning-orders-test?send=1   — отправить в Telegram прямо сейчас
import { runReport } from "../lib/morning-core.mjs";

export default async (req) => {
  const send = new URL(req.url).searchParams.get("send") === "1";
  try {
    const text = await runReport(send);
    return new Response((send ? "ОТПРАВЛЕНО В TELEGRAM\n\n" : "ПРЕДПРОСМОТР (не отправлено)\n\n") + text,
      { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (e) {
    return new Response("Ошибка: " + (e && e.message), { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
};
