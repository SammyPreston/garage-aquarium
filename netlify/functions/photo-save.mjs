// Фото карточек хранятся на самом сайте: папка img/cards в репозитории GitHub, Netlify отдаёт их со своего CDN.
// Админка присылает уже сжатые фото (WebP) — функция одним коммитом кладёт их в репозиторий,
// после коммита Netlify пересобирает сайт (~1 мин) и фото доступны по адресу /img/cards/<имя>.
// Писать может только админ сайта: проверяем Firebase-токен входа (accounts:lookup).
// Переменные Netlify: GH_TOKEN — токен GitHub (доступ Contents: Read and write к этому репозиторию).
const API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyA71lBgfJ-lF_Ln1NHO--dEsgB16Pshyp4";
const ADMIN = (process.env.ADMIN_EMAIL || "admin@garageaquarium.shop").toLowerCase();
const REPO = process.env.GH_REPO || "SammyPreston/garage-aquarium";
const BRANCH = process.env.GH_BRANCH || "main";
const DIR = "img/cards";
const MAX_FILES = 25, MAX_BYTES = 1500000;

function originOk(o) {
  if (!o) return false;
  const extra = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return o === "https://garageaquariumshop.netlify.app" || extra.includes(o) ||
    /^https:\/\/[a-z0-9-]+--garageaquariumshop\.netlify\.app$/.test(o);
}

async function gh(path, opts = {}) {
  const r = await fetch("https://api.github.com/repos/" + REPO + path, {
    ...opts,
    headers: { "Authorization": "Bearer " + process.env.GH_TOKEN, "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "garage-aquarium-photos" }
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  if (!r.ok) { const err = new Error("GitHub " + r.status + ": " + (j && j.message ? j.message : txt.slice(0, 200))); err.status = r.status; throw err; }
  return j;
}

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const ok = originOk(origin);
  const cors = { "Access-Control-Allow-Origin": ok ? origin : "https://garageaquariumshop.netlify.app",
                 "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS",
                 "Content-Type": "application/json" };
  const reply = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: cors });
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { ok: false, error: "Method Not Allowed" });
  if (!ok) return reply(403, { ok: false, error: "Forbidden origin" });
  if (!process.env.GH_TOKEN) return reply(500, { ok: false, error: "GH_TOKEN не задан в Netlify" });

  // 1. только админ
  const auth = req.headers.get("authorization") || "";
  const idToken = auth.replace(/^Bearer\s+/i, "");
  if (!idToken) return reply(401, { ok: false, error: "Нет входа" });
  try {
    const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + API_KEY, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken })
    });
    const j = await r.json();
    const email = j && Array.isArray(j.users) && j.users[0] ? String(j.users[0].email || "").toLowerCase() : "";
    if (!r.ok || email !== ADMIN) return reply(403, { ok: false, error: "Только для админа" });
  } catch (e) { return reply(401, { ok: false, error: "Проверка входа не удалась" }); }

  // 2. файлы
  let body = {};
  try { body = await req.json(); } catch (e) { return reply(400, { ok: false, error: "Bad JSON" }); }
  // files — новые фото (base64); blobs — уже загруженные раньше ({name, sha}); commit:false — только загрузить, без коммита
  // (перенос многих фото: пачками без коммита, потом один коммит — один пересбор сайта)
  const files = Array.isArray(body.files) ? body.files : [];
  const prev = Array.isArray(body.blobs) ? body.blobs : [];
  const doCommit = body.commit !== false;
  if (files.length > MAX_FILES || prev.length > 1000 || (!files.length && !prev.length)) return reply(400, { ok: false, error: "Нужно от 1 до " + MAX_FILES + " файлов" });
  for (const b of prev) {
    if (!b || typeof b.name !== "string" || !/^[a-z0-9_-]{1,80}\.(webp|jpg|jpeg|png)$/.test(b.name) || !/^[0-9a-f]{40}$/.test(String(b.sha))) return reply(400, { ok: false, error: "Плохой список blobs" });
  }
  for (const f of files) {
    if (!f || typeof f.name !== "string" || !/^[a-z0-9_-]{1,80}\.(webp|jpg|jpeg|png)$/.test(f.name)) return reply(400, { ok: false, error: "Плохое имя файла" });
    if (typeof f.data !== "string" || !f.data.length) return reply(400, { ok: false, error: "Пустой файл " + f.name });
    if (Math.floor(f.data.length * 3 / 4) > MAX_BYTES) return reply(413, { ok: false, error: "Файл слишком большой: " + f.name });
  }

  // 3. один коммит на все файлы (git data API); при гонке с другим коммитом — повтор
  try {
    const made = await Promise.all(files.map(f =>
      gh("/git/blobs", { method: "POST", body: JSON.stringify({ content: f.data, encoding: "base64" }) }).then(b => ({ name: f.name, sha: b.sha }))));
    if (!doCommit) return reply(200, { ok: true, blobs: made, paths: made.map(b => "/" + DIR + "/" + b.name) });
    const all = prev.concat(made);
    const blobs = all.map(b => ({ path: DIR + "/" + b.name, mode: "100644", type: "blob", sha: b.sha }));
    let commitSha = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await gh("/git/ref/heads/" + BRANCH);
      const head = ref.object.sha;
      const base = await gh("/git/commits/" + head);
      const tree = await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: base.tree.sha, tree: blobs }) });
      const commit = await gh("/git/commits", { method: "POST", body: JSON.stringify({
        message: "Фото карточек (" + all.length + "): " + all.map(f => f.name).join(", ").slice(0, 200), tree: tree.sha, parents: [head] }) });
      try {
        await gh("/git/refs/heads/" + BRANCH, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
        commitSha = commit.sha; break;
      } catch (e) { if (e.status !== 422 || attempt === 2) throw e; }
    }
    return reply(200, { ok: true, commit: commitSha, paths: all.map(f => "/" + DIR + "/" + f.name) });
  } catch (e) {
    return reply(502, { ok: false, error: String(e && e.message || e) });
  }
};
