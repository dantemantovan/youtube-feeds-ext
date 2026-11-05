/**
 * Fetch & parse YouTube public RSS feeds (no API key).
 * https://www.youtube.com/feeds/videos.xml?channel_id=UC...
 */

const RSS_BASE = "https://www.youtube.com/feeds/videos.xml?channel_id=";

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   link: string,
 *   published: string,
 *   publishedMs: number,
 *   author: string,
 *   thumbnail: string,
 *   channelId: string,
 *   isShort: boolean
 * }} VideoEntry
 */

function textOf(el, sel) {
  const n = el.querySelector(sel);
  return n ? (n.textContent || "").trim() : "";
}

function attrOf(el, sel, attr) {
  const n = el.querySelector(sel);
  return n ? n.getAttribute(attr) || "" : "";
}

function isShortsLink(href) {
  return /\/shorts\//i.test(href || "");
}

/**
 * Parse Atom XML from YouTube RSS into video entries.
 * @param {string} xml
 * @param {string} channelId
 * @returns {VideoEntry[]}
 */
export function parseRssXml(xml, channelId) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid RSS XML");
  }

  const entries = [...doc.querySelectorAll("entry")];
  return entries
    .map((entry) => {
      const idRaw = textOf(entry, "yt\\:videoId") || textOf(entry, "videoId");
      // Fallback: extract from <id>yt:video:VIDEOID</id>
      let id = idRaw;
      if (!id) {
        const fullId = textOf(entry, "id");
        const m = fullId.match(/yt:video:(.+)$/);
        id = m ? m[1] : "";
      }

      const linkEl =
        entry.querySelector('link[rel="alternate"]') ||
        entry.querySelector("link");
      const link = linkEl
        ? linkEl.getAttribute("href") || ""
        : id
          ? `https://www.youtube.com/watch?v=${id}`
          : "";

      const published = textOf(entry, "published") || textOf(entry, "updated");
      const publishedMs = published ? Date.parse(published) : 0;

      const author =
        textOf(entry, "author > name") ||
        textOf(entry, "name") ||
        "";

      const thumb =
        attrOf(entry, "media\\:thumbnail", "url") ||
        attrOf(entry, "thumbnail", "url") ||
        (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "");

      const title = textOf(entry, "title");

      return {
        id,
        title,
        link,
        published,
        publishedMs,
        author,
        thumbnail: thumb,
        channelId,
        duration: Number(attrOf(entry, "yt\\:duration", "seconds") || attrOf(entry, "duration", "seconds")) || null,
        isShort: isShortsLink(link),
      };
    })
    .filter((v) => v.id && v.title && !v.isShort);
}

/**
 * Fetch RSS for one channel. Uses fetch (service worker or extension page).
 * In service worker there is no DOMParser — caller may request text and
 * parse in a page context, OR we use a lightweight regex parser here.
 */
export async function fetchChannelRss(channelId) {
  if (!channelId || !/^UC[\w-]{22}$/.test(channelId)) {
    throw new Error("Invalid channel ID");
  }
  const url = RSS_BASE + encodeURIComponent(channelId);
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`RSS fetch failed (${res.status}) for ${channelId}`);
  }
  const xml = await res.text();
  return { xml, channelId };
}

/**
 * Lightweight Atom parser that works in service workers (no DOMParser).
 * @param {string} xml
 * @param {string} channelId
 * @returns {VideoEntry[]}
 */
export function parseRssXmlLite(xml, channelId) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const pick = (re) => {
      const x = block.match(re);
      return x ? x[1].trim() : "";
    };

    let id = pick(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!id) {
      const full = pick(/<id>([^<]+)<\/id>/);
      const vm = full.match(/yt:video:(.+)$/);
      id = vm ? vm[1] : "";
    }

    const title = decodeXml(
      pick(/<title[^>]*>([\s\S]*?)<\/title>/)
    );
    let link = pick(/<link[^>]*href="([^"]+)"/);
    if (!link && id) link = `https://www.youtube.com/watch?v=${id}`;

    const published =
      pick(/<published>([^<]+)<\/published>/) ||
      pick(/<updated>([^<]+)<\/updated>/);
    const author = decodeXml(
      pick(/<author>\s*<name>([^<]+)<\/name>/)
    );
    let thumb = pick(/<media:thumbnail[^>]*url="([^"]+)"/);
    if (!thumb && id) thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

    if (!id || !title) continue;
    if (isShortsLink(link)) continue;

    entries.push({
      id,
      title,
      link,
      published,
      publishedMs: published ? Date.parse(published) : 0,
      author,
      thumbnail: thumb,
      channelId,
      duration: Number(pick(/<yt:duration[^>]*seconds="(\d+)"/)) || null,
      views: pick(/<media:statistics[^>]*views="(\d+)"/) ? Number(pick(/<media:statistics[^>]*views="(\d+)"/)) : null,
      isShort: false,
    });
  }
  return entries;
}

function decodeXml(s) {
  return (s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Fetch + parse one channel; returns VideoEntry[].
 */
export async function getChannelVideos(channelId) {
  const { xml } = await fetchChannelRss(channelId);
  // Prefer lite parser (works everywhere)
  return parseRssXmlLite(xml, channelId);
}

/**
 * Merge videos from many channels, sort by date desc, dedupe by video id.
 * @param {VideoEntry[][]} lists
 * @returns {VideoEntry[]}
 */
export function mergeAndSort(lists) {
  const map = new Map();
  for (const list of lists) {
    for (const v of list) {
      if (!map.has(v.id)) map.set(v.id, v);
    }
  }
  return [...map.values()].sort((a, b) => b.publishedMs - a.publishedMs);
}
