/**
 * Resolve @handles / channel URLs to UC... channel IDs by fetching the
 * channel page once and caching the result.
 */

import { cacheChannelId, getChannelIdCache } from "./storage.js";

const CHANNEL_ID_RE = /UC[\w-]{22}/;
const CANONICAL_RE =
  /<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/i;
const META_CHANNEL_RE =
  /"channelId"\s*:\s*"(UC[\w-]{22})"/;
const BROWSE_ID_RE = /"browseId"\s*:\s*"(UC[\w-]{22})"/;
const EXTERNAL_ID_RE = /"externalId"\s*:\s*"(UC[\w-]{22})"/;

/**
 * Normalize user input into a channel page URL and cache key.
 * Accepts: UC..., @handle, youtube.com/@x, youtube.com/channel/UC..., youtube.com/c/Name
 */
export function parseChannelInput(raw) {
  const input = (raw || "").trim();
  if (!input) return null;

  // Bare channel ID
  if (/^UC[\w-]{22}$/.test(input)) {
    return {
      channelId: input,
      url: `https://www.youtube.com/channel/${input}`,
      handle: "",
      cacheKey: input,
    };
  }

  // @handle
  if (/^@[\w.-]+$/.test(input)) {
    return {
      channelId: "",
      url: `https://www.youtube.com/${input}`,
      handle: input,
      cacheKey: input.toLowerCase(),
    };
  }

  let url = input;
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url.replace(/^\/+/, "");
  }

  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtu.be") {
      return null;
    }

    // /channel/UC...
    const ch = u.pathname.match(/\/channel\/(UC[\w-]{22})/);
    if (ch) {
      return {
        channelId: ch[1],
        url: `https://www.youtube.com/channel/${ch[1]}`,
        handle: "",
        cacheKey: ch[1],
      };
    }

    // /@handle
    const handleMatch = u.pathname.match(/\/(@[\w.-]+)/);
    if (handleMatch) {
      return {
        channelId: "",
        url: `https://www.youtube.com/${handleMatch[1]}`,
        handle: handleMatch[1],
        cacheKey: handleMatch[1].toLowerCase(),
      };
    }

    // /c/Name or /user/Name — resolve via fetch
    const custom = u.pathname.match(/\/(c|user)\/([^/]+)/);
    if (custom) {
      const path = `/${custom[1]}/${custom[2]}`;
      return {
        channelId: "",
        url: `https://www.youtube.com${path}`,
        handle: "",
        cacheKey: path.toLowerCase(),
      };
    }

    return {
      channelId: "",
      url: `https://www.youtube.com${u.pathname}`,
      handle: "",
      cacheKey: u.pathname.toLowerCase(),
    };
  } catch (_) {
    return null;
  }
}

function extractChannelId(html) {
  if (!html) return "";
  const patterns = [
    CANONICAL_RE,
    EXTERNAL_ID_RE,
    META_CHANNEL_RE,
    BROWSE_ID_RE,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  // Last resort: first UC id that looks like a channel (avoid video owners randomly)
  const all = html.match(/UC[\w-]{22}/g);
  if (all && all.length) {
    // Prefer the most common UC id on the page
    const counts = {};
    for (const id of all) counts[id] = (counts[id] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  return "";
}

/**
 * Resolve a channel to a UC... id. Uses cache, then known id, then fetch.
 */
export async function resolveChannelId(channel) {
  if (channel.channelId && CHANNEL_ID_RE.test(channel.channelId)) {
    return channel.channelId;
  }

  const parsed = parseChannelInput(
    channel.url || channel.handle || channel.channelId || ""
  );
  if (!parsed) throw new Error("Invalid channel input");

  if (parsed.channelId) return parsed.channelId;

  const cache = await getChannelIdCache();
  if (cache[parsed.cacheKey]) return cache[parsed.cacheKey];

  const res = await fetch(parsed.url, {
    credentials: "omit",
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch channel page (${res.status})`);
  }
  const html = await res.text();
  const id = extractChannelId(html);
  if (!id) throw new Error("Could not find channel ID on page");

  await cacheChannelId(parsed.cacheKey, id);
  return id;
}

/**
 * Build a channel object from user input + optional display name.
 */
export async function buildChannelFromInput(raw, displayName = "") {
  const parsed = parseChannelInput(raw);
  if (!parsed) throw new Error("Enter a channel URL, @handle, or channel ID");

  let channelId = parsed.channelId;
  if (!channelId) {
    channelId = await resolveChannelId({
      url: parsed.url,
      handle: parsed.handle,
    });
  } else {
    await cacheChannelId(parsed.cacheKey, channelId);
  }

  let name = displayName.trim();
  if (!name) {
    name = parsed.handle
      ? parsed.handle.replace(/^@/, "")
      : channelId;
  }

  return {
    name,
    handle: parsed.handle || "",
    channelId,
    url: parsed.url || `https://www.youtube.com/channel/${channelId}`,
  };
}
