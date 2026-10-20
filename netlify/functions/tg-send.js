// Отправка сообщений в Telegram для сайта Garage Aquarium (этап 2, безопасность).
// Токен бота хранится ТОЛЬКО в переменных Netlify: TG_TOKEN и TG_CHAT.
// Сайт шлёт сюда { method: "sendMessage", text: "..." }; чат всегда берётся из TG_CHAT,
// поэтому через функцию нельзя писать в чужие чаты.
const https = require('https');

const DEFAULT_ORIGINS = ['https://garageaquariumshop.netlify.app'];

function allowedOrigin(origin) {
  if (!origin) return false;
  const list = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const all = list.length ? list : DEFAULT_ORIGINS;
  if (all.includes(origin)) return true;
  // превью-деплои Netlify: https://<что-то>--garageaquariumshop.netlify.app
  return /^https:\/\/[a-z0-9-]+--garageaquariumshop\.netlify\.app$/.test(origin);
}

exports.handler = async function (event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const ok = allowedOrigin(origin);
  const cors = {
    'Access-Control-Allow-Origin': ok ? origin : DEFAULT_ORIGINS[0],
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const reply = (code, obj) => ({ statusCode: code, headers: cors, body: JSON.stringify(obj) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, description: 'Method Not Allowed' });
  if (!ok) return reply(403, { ok: false, description: 'Forbidden origin' });

  const token = process.env.TG_TOKEN;
  const chat = process.env.TG_CHAT;
  if (!token || !chat) return reply(500, { ok: false, description: 'TG_TOKEN / TG_CHAT not configured' });

  let data = {};
  try { data = JSON.parse(event.body || '{}') || {}; } catch (e) { return reply(400, { ok: false, description: 'Bad JSON' }); }
  if (data.method !== 'sendMessage') return reply(400, { ok: false, description: 'Only sendMessage is allowed' });
  let text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) return reply(400, { ok: false, description: 'Empty text' });
  if (text.length > 4000) text = text.slice(0, 4000) + '…';

  const payload = JSON.stringify({ chat_id: chat, text: text });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + token + '/sendMessage',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        // отдаём ответ Telegram как есть ({ ok: true, ... }) — сайт проверяет data.ok
        resolve({ statusCode: 200, headers: cors, body: body || JSON.stringify({ ok: false }) });
      });
    });
    req.on('error', (e) => resolve(reply(502, { ok: false, description: e.message })));
    req.write(payload);
    req.end();
  });
};
