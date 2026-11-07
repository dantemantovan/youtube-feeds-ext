/**
 * Algorithm feed: approximate YouTube Home recommendations by fetching
 * https://www.youtube.com/ with the extension's cookies (same browser profile)
 * and parsing rich-grid / lockup video renderers from ytInitialData.
 * No API key. Results are cached briefly in chrome.storage.local.
 */
const CACHE_KEY = "algorithmCache";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function initialData(html) {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (_) {
    return null;
  }
}

function* walk(o, key) {
  if (Array.isArray(o)) {
    for (const v of o) yield* walk(v, key);
  } else if (o && typeof o === "object") {
    if (o[key]) yield o[key];
    for (const v of Object.values(o)) yield* walk(v, key);
  }
}

function textRuns(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.simpleText) return obj.simpleText;
  if (obj.content) return obj.content;
  if (Array.isArray(obj.runs)) return obj.runs.map((r) => r.text || "").join("");
  return "";
}

function parseLen(t) {
  if (!/^\d+(:\d{2}){1,2}$/.test(t || "")) return null;
  return t.split(":").reduce((a, n) => a * 60 + Number(n), 0);
}

function parseViews(t) {
  if (!t) return null;
  const m = String(t).replace(/,/g, "").match(/([\d.]+)\s*([KMB])?\s*view/i);
  if (!m) {
    const n = String(t).replace(/,/g, "").match(/^(\d+)\s*view/i);
    return n ? Number(n[1]) : null;
  }
  let n = Number(m[1]);
  const u = (m[2] || "").toUpperCase();
  if (u === "K") n *= 1e3;
  else if (u === "M") n *= 1e6;
  else if (u === "B") n *= 1e9;
  return Math.round(n);
}

function parseRelativeMs(t) {
  if (!t) return 0;
  const s = String(t).toLowerCase();
  const m = s.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2];
  const mult = {
    second: 1e3,
    minute: 6e4,
    hour: 36e5,
    day: 864e5,
    week: 6048e5,
    month: 2592e6,
    year: 31536e6,
  }[unit];
  return mult ? Date.now() - n * mult : 0;
}

function isShortish(renderer, durationSec, title) {
  if (renderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url?.includes("/shorts/")) return true;
  if (/\/shorts\//i.test(title || "")) return true;
  // Home often marks Shorts with a reel badge or overlay
  const badges = [...walk(renderer || {}, "thumbnailOverlayTimeStatusRenderer")];
  for (const b of badges) {
    if (String(b.style || "").includes("SHORTS") || /short/i.test(textRuns(b.text))) return true;
  }
  if (durationSec != null && durationSec > 0 && durationSec <= 60) {
    // Ambiguous; only drop if a Shorts badge exists
    const hasShortBadge = [...walk(renderer || {}, "metadataBadgeRenderer")].some(
      (b) => /short/i.test(b.label || b.style || "")
    );
    if (hasShortBadge) return true;
  }
  return false;
}

function pushVideo(out, seen, { id, title, author, thumbnail, duration, views, publishedMs, published }) {
  if (!id || !/^[\w-]{11}$/.test(id) || !title || seen.has(id)) return;
  if (/\/shorts\//i.test(title)) return;
  seen.add(id);
  out.push({
    id,
    title,
    author: author || "",
    link: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    published: published || "",
    publishedMs: publishedMs || 0,
    channelId: "",
    duration: duration || null,
    views: views != null ? views : null,
    isShort: false,
  });
}

function fromRichItem(r) {
  const id = r.videoId;
  if (!id) return null;
  const title = textRuns(r.title);
  const author =
    textRuns(r.ownerText) ||
    textRuns(r.shortBylineText) ||
    textRuns(r.longBylineText) ||
    "";
  const thumbs = r.thumbnail?.thumbnails || [];
  const thumbnail = thumbs.length ? thumbs[thumbs.length - 1].url : "";
  const lenText =
    textRuns(r.lengthText) ||
    [...walk(r, "thumbnailOverlayTimeStatusRenderer")].map((x) => textRuns(x.text)).find(Boolean) ||
    "";
  const duration = r.lengthSeconds ? Number(r.lengthSeconds) : parseLen(lenText);
  const viewText =
    textRuns(r.viewCountText) ||
    textRuns(r.shortViewCountText) ||
    "";
  const views = parseViews(viewText);
  const pubText = textRuns(r.publishedTimeText);
  const publishedMs = parseRelativeMs(pubText);
  if (isShortish(r, duration, title)) return null;
  return { id, title, author, thumbnail, duration, views, publishedMs, published: pubText };
}

function fromLockup(l) {
  if (l.contentType && l.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;
  const id = l.contentId;
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const md = l.metadata?.lockupMetadataViewModel;
  const title = md?.title?.content || "";
  const rows = md?.metadata?.contentMetadataViewModel?.metadataRows || [];
  const author = rows[0]?.metadataParts?.[0]?.text?.content || "";
  let views = null;
  let publishedMs = 0;
  let published = "";
  for (const row of rows) {
    for (const part of row.metadataParts || []) {
      const t = part?.text?.content || "";
      if (/view/i.test(t)) views = parseViews(t);
      if (/ago/i.test(t)) {
        published = t;
        publishedMs = parseRelativeMs(t);
      }
    }
  }
  const img =
    [...walk(l.contentImage, "thumbnailViewModel")][0]?.image?.sources?.slice(-1)[0]?.url || "";
  const badge = [...walk(l.contentImage, "thumbnailBadgeViewModel")][0]?.text || "";
  const duration = parseLen(badge);
  if (/short/i.test(badge) || l.contentType === "LOCKUP_CONTENT_TYPE_SHORT") return null;
  return { id, title, author, thumbnail: img, duration, views, publishedMs, published };
}

/**
 * Scrape Home recommendations. Throws if signed-out / empty / parse failure.
 * @returns {Promise<{videos: object[], scrapedAt: number, signedIn: boolean}>}
 */
export async function scrapeHomeRecommendations() {
  const res = await fetch("https://www.youtube.com/?hl=en&persist_hl=1", {
    credentials: "include",
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`YouTube Home returned ${res.status}`);
  const html = await res.text();
  const signedIn =
    /"LOGGED_IN":\s*true/.test(html) ||
    /"isLoggedIn":\s*true/.test(html) ||
    /"logged_in":\s*true/i.test(html);

  const data = initialData(html);
  const out = [];
  const seen = new Set();

  if (data) {
    for (const r of walk(data, "videoRenderer")) {
      const v = fromRichItem(r);
      if (v) pushVideo(out, seen, v);
    }
    for (const r of walk(data, "gridVideoRenderer")) {
      const v = fromRichItem(r);
      if (v) pushVideo(out, seen, v);
    }
    for (const r of walk(data, "richItemRenderer")) {
      const inner = r.content?.videoRenderer || r.content?.gridVideoRenderer;
      if (inner) {
        const v = fromRichItem(inner);
        if (v) pushVideo(out, seen, v);
      }
    }
    for (const l of walk(data, "lockupViewModel")) {
      const v = fromLockup(l);
      if (v) pushVideo(out, seen, v);
    }
  }

  // Fallback: scrape watch links from HTML if JSON walk found nothing
  if (!out.length) {
    const re = /watch\?v=([\w-]{11})/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      pushVideo(out, seen, {
        id: m[1],
        title: m[1],
        author: "",
        thumbnail: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`,
        duration: null,
        views: null,
        publishedMs: 0,
        published: "",
      });
      if (out.length >= 40) break;
    }
    // Title-less fallback is useless for UI — drop if we only got ids
    if (out.every((v) => v.title === v.id)) out.length = 0;
  }

  if (!out.length) {
    const err = new Error(
      signedIn
        ? "Couldn't parse Home recommendations (YouTube markup may have changed)."
        : "Sign in to YouTube in this browser profile, then Sync / Refresh."
    );
    err.code = signedIn ? "PARSE" : "SIGNED_OUT";
    err.signedIn = signedIn;
    throw err;
  }

  return { videos: out, scrapedAt: Date.now(), signedIn };
}

export async function getCachedAlgorithm() {
  const row = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
  if (!row || !Array.isArray(row.videos) || !row.videos.length) return null;
  if (Date.now() - (row.scrapedAt || 0) > CACHE_TTL_MS) return null;
  return row;
}

export async function setCachedAlgorithm(payload) {
  await chrome.storage.local.set({
    [CACHE_KEY]: {
      videos: payload.videos,
      scrapedAt: payload.scrapedAt || Date.now(),
      signedIn: !!payload.signedIn,
    },
  });
}

/**
 * Return Home recommendations, using short-lived cache unless force=true.
 */
export async function fetchAlgorithmFeed({ force = false } = {}) {
  if (!force) {
    const cached = await getCachedAlgorithm();
    if (cached) return { ok: true, videos: cached.videos, cached: true, scrapedAt: cached.scrapedAt };
  }
  try {
    const result = await scrapeHomeRecommendations();
    await setCachedAlgorithm(result);
    return { ok: true, videos: result.videos, cached: false, scrapedAt: result.scrapedAt, signedIn: result.signedIn };
  } catch (e) {
    const cached = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
    if (cached?.videos?.length) {
      return {
        ok: true,
        videos: cached.videos,
        cached: true,
        stale: true,
        scrapedAt: cached.scrapedAt,
        warning: String(e.message || e),
      };
    }
    return {
      ok: false,
      error: String(e.message || e),
      code: e.code || "ERROR",
      signedIn: !!e.signedIn,
      videos: [],
    };
  }
}
