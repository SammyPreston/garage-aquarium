const https = require('https');

exports.handler = async function(event) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  // Этап 2 (безопасность): принимаем запросы только с сайта магазина, чтобы чужие сайты
  // не расходовали ключ Claude. Дополнительные адреса можно указать в ALLOWED_ORIGINS (через запятую).
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowed = origin === 'https://garageaquariumshop.netlify.app' || extra.includes(origin) ||
    /^https:\/\/[a-z0-9-]+--garageaquariumshop\.netlify\.app$/.test(origin);
  if (!allowed) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden origin' }) };
  return new Promise((resolve) => {
    try {
      const body = event.body;
      const apiKey = process.env.CLAUDE_API_KEY;
      const opts = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const req = https.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: data }));
      });
      req.on('error', (e) => resolve({ statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) }));
      req.write(body);
      req.end();
    } catch(e) {
      resolve({ statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) });
    }
  });
};
