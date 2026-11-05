/**
 * Playlists: user's YouTube playlist list (chrome.storage.local) + playlist RSS.
 * Sources (merged, deduped by playlistId):
 *  1. playlists.local.json in the extension folder (gitignored; dropped in by sync)
 *  2. Manual adds / JSON import from Settings
 *  3. Best-effort scrape of youtube.com/feed/playlists using the browser's YouTube login
 */
import { parseRssXmlLite } from "./rss.js";

const KEY = "playlists";
const PL_RE = /^[\w-]{2,64}$/;

export function parsePlaylistId(input) {
  const s = String(input || "").trim();
  const m = s.match(/[?&]list=([\w-]+)/);
  if (m) return m[1];
  return PL_RE.test(s) ? s : "";
}

function normalize(p) {
  if (!p) return null;
  const playlistId = p.playlistId || p.id || parsePlaylistId(p.url);
  if (!playlistId) return null;
  return {
    playlistId,
    name: String(p.name || p.title || playlistId),
    url: p.url || `https://www.youtube.com/playlist?list=${playlistId}`,
    thumbnail: p.thumbnail || p.thumb || "",
    videoCount: p.videoCount != null && p.videoCount !== "" ? Number(p.videoCount) || null : null,
    source: p.source || "manual",
    enabled: p.enabled !== false,
  };
}

export function mergePlaylists(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const raw of list || []) {
      const p = normalize(raw);
      if (!p) continue;
      const prev = map.get(p.playlistId);
      if (!prev) {
        map.set(p.playlistId, p);
        continue;
      }
      const merged = { ...prev };
      for (const [k, v] of Object.entries(p)) {
        if (v == null || v === "") continue;
        if (k === "enabled") continue; // keep stored toggle; scrapes/files omit it
        merged[k] = v;
      }
      if (Object.prototype.hasOwnProperty.call(raw, "enabled")) {
        merged.enabled = raw.enabled !== false;
      }
      map.set(p.playlistId, merged);
    }
  }
  return [...map.values()];
}

export async function setPlaylistEnabled(playlistId, enabled) {
  const list = await getPlaylists();
  const next = list.map((p) =>
    p.playlistId === playlistId ? { ...p, enabled: !!enabled } : p
  );
  return setPlaylists(next);
}

export function isPlaylistEnabled(p) {
  return !p || p.enabled !== false;
}

export async function getPlaylists() {
  return (await chrome.storage.local.get(KEY))[KEY] || [];
}
export async function setPlaylists(list) {
  const clean = mergePlaylists(list);
  await chrome.storage.local.set({ [KEY]: clean });
  return clean;
}
export async function addPlaylists(list) {
  return setPlaylists(mergePlaylists(await getPlaylists(), list));
}
export async function removePlaylist(playlistId) {
  return setPlaylists((await getPlaylists()).filter((p) => p.playlistId !== playlistId));
}

/** Read bundled playlists.local.json (absent in the git repo). */
export async function readBundledPlaylists() {
  try {
    const res = await fetch(chrome.runtime.getURL("playlists.local.json"), { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const arr = Array.isArray(data) ? data : data.playlists || [];
    return arr.map((p) => ({ ...p, source: "file" }));
  } catch (_) {
    return [];
  }
}

/** Best-effort: scrape the signed-in user's playlists page (youtube.com/feed/playlists). */
export async function scrapeYouTubePlaylists() {
  const res = await fetch("https://www.youtube.com/feed/playlists?hl=en", { credentials: "include" });
  if (!res.ok) throw new Error(`YouTube returned ${res.status}`);
  const data = initialData(await res.text());
  const out = [];
  if (data) {
    for (const l of walk(data, "lockupViewModel")) {
      if (!/PLAYLIST|PODCAST/.test(l.contentType || "")) continue;
      const md = l.metadata?.lockupMetadataViewModel;
      const img = [...walk(l.contentImage, "thumbnailViewModel")][0]?.image?.sources?.slice(-1)[0]?.url || "";
      const badge = [...walk(l.contentImage, "thumbnailBadgeViewModel")][0]?.text || "";
      const count = (badge.match(/(\d[\d,]*)\s+video/) || [])[1];
      out.push({ playlistId: l.contentId, name: md?.title?.content || l.contentId, thumbnail: img,
        videoCount: count ? Number(count.replace(/,/g, "")) : null, source: "youtube" });
    }
    for (const r of walk(data, "gridPlaylistRenderer")) {
      out.push({ playlistId: r.playlistId, name: r.title?.runs?.[0]?.text || r.title?.simpleText,
        thumbnail: r.thumbnail?.thumbnails?.slice(-1)[0]?.url || "", videoCount: Number(r.videoCountShortText?.simpleText) || null, source: "youtube" });
    }
  }
  if (!out.length) throw new Error("No playlists found — sign in to YouTube in this browser, then retry");
  return out;
}

/** Re-read file + optional scrape, merge into storage. */
export async function refreshPlaylists({ scrape = false } = {}) {
  const errors = [];
  const fromFile = await readBundledPlaylists();
  let fromYt = [];
  if (scrape) {
    try { fromYt = await scrapeYouTubePlaylists(); } catch (e) { errors.push(String(e.message || e)); }
  }
  const list = await setPlaylists(mergePlaylists(await getPlaylists(), fromFile, fromYt));
  return { list, added: { file: fromFile.length, youtube: fromYt.length }, errors };
}

function initialData(html) {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (_) { return null; }
}
function* walk(o, key) {
  if (Array.isArray(o)) { for (const v of o) yield* walk(v, key); }
  else if (o && typeof o === "object") {
    if (o[key]) yield o[key];
    for (const v of Object.values(o)) yield* walk(v, key);
  }
}
const parseLen = (t) => {
  if (!/^\d+(:\d{2}){1,2}$/.test(t || "")) return null;
  return t.split(":").reduce((a, n) => a * 60 + Number(n), 0);
};

/** Scrape playlist page with the browser's YouTube login (private playlists). First ~100 videos. */
export async function scrapePlaylistPage(playlistId) {
  const res = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`, { credentials: "include" });
  if (!res.ok) throw new Error(`Playlist page failed (${res.status})`);
  const data = initialData(await res.text());
  const videos = [];
  const seen = new Set();
  const push = (id, title, author, duration) => {
    if (!id || !title || seen.has(id)) return;
    seen.add(id);
    videos.push({
      id, title, author: author || "",
      link: `https://www.youtube.com/watch?v=${id}&list=${playlistId}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      published: "", publishedMs: 0, channelId: "", duration: duration || null, isShort: false,
    });
  };
  if (data) {
    for (const r of walk(data, "playlistVideoRenderer")) {
      push(r.videoId, r.title?.runs?.[0]?.text || r.title?.simpleText, r.shortBylineText?.runs?.[0]?.text, Number(r.lengthSeconds) || null);
    }
    for (const l of walk(data, "lockupViewModel")) {
      if (l.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") continue;
      const md = l.metadata?.lockupMetadataViewModel;
      const rows = md?.metadata?.contentMetadataViewModel?.metadataRows || [];
      const author = rows[0]?.metadataParts?.[0]?.text?.content;
      const badge = [...walk(l.contentImage, "thumbnailBadgeViewModel")][0]?.text;
      push(l.contentId, md?.title?.content, author, parseLen(badge));
    }
  }
  if (!videos.length) throw new Error("Playlist is private/empty or you're not signed in to YouTube in this browser");
  const title = data?.metadata?.playlistMetadataRenderer?.title || "";
  return { title, videos };
}

/** Fetch a playlist's videos via public Atom RSS (max ~15 newest entries). */
export async function getPlaylistVideos(playlistId) {
  if (!PL_RE.test(playlistId || "")) throw new Error("Invalid playlist ID");
  const res = await fetch(
    `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`,
    { credentials: "omit" }
  );
  if (!res.ok) return scrapePlaylistPage(playlistId); // private/unlisted/LL/WL: RSS 404s
  const xml = await res.text();
  const titleM = xml.match(/<feed[\s\S]*?<title>([^<]*)<\/title>/);
  return { title: titleM ? titleM[1] : "", videos: parseRssXmlLite(xml, "") };
}
