// Video duration lookup: parses lengthSeconds from the YouTube watch page.
const CACHE_KEY = "durationCache";
const MAX_ENTRIES = 3000;
let cache = null;
export const views = {}; // in-memory view counts parsed from watch pages
const inflight = new Map();

async function loadCache() {
  if (!cache) cache = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
  return cache;
}
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keys = Object.keys(cache);
    if (keys.length > MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete cache[k];
    chrome.storage.local.set({ [CACHE_KEY]: cache });
  }, 500);
}

function parseLength(text, id) {
  const vm = text.match(/"viewCount":"(\d+)"/);
  if (vm) views[id] = Number(vm[1]);
  let m = text.match(/"lengthSeconds":"(\d+)"/);
  if (m) return Number(m[1]);
  m = text.match(/"approxDurationMs":"(\d+)"/);
  if (m) return Math.round(Number(m[1]) / 1000);
  m = text.match(/itemprop="duration" content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/);
  if (m) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return null;
}

// Primary: InnerTube player API (small JSON, no consent/bot interstitial issues).
async function fetchViaPlayer(id) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoId: id, context: { client: { clientName: "WEB", clientVersion: "2.20241101.00.00", hl: "en" } } }),
  });
  if (!res.ok) return null;
  return parseLength(await res.text(), id);
}

// Fallback: scrape the watch page.
async function fetchViaWatch(id) {
  const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`, { credentials: "include" });
  if (!res.ok) return null;
  return parseLength(await res.text(), id);
}

async function fetchDuration(id) {
  let s = null;
  try { s = await fetchViaPlayer(id); } catch (_) {}
  if (s == null) { try { s = await fetchViaWatch(id); } catch (_) {} }
  return s;
}

export async function getDuration(id, wantViews = false) {
  if (!/^[\w-]{11}$/.test(id || "")) return null;
  const c = await loadCache();
  if (views[id] == null && c['v:' + id] != null) views[id] = c['v:' + id];
  if (c[id] != null && (!wantViews || views[id] != null)) return c[id];
  if (inflight.has(id)) return inflight.get(id);
  const p = fetchDuration(id)
    .then((s) => { if (s != null && s > 0) { c[id] = s; if (views[id] != null) c['v:' + id] = views[id]; scheduleSave(); } return s || null; }) // 0 = live/upcoming, don't cache
    .catch(() => null)
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

export async function getDurations(ids, concurrency = 4, viewIds = []) {
  const want = new Set(viewIds);
  const out = {};
  const queue = [...new Set(ids)];
  const worker = async () => { while (queue.length) { const id = queue.shift(); out[id] = await getDuration(id, want.has(id)); } };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
