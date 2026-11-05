/**
 * chrome.storage.sync with local fallback.
 * Shape:
 * {
 *   settings: { hideShorts: boolean, feedsInitialized: boolean },
 *   feedList: Array<{ id, name, icon, description, builtin }>,  // ordered curated feed metadata (v1.6.0+)
 *   feeds: { [feedId: string]: Channel[] },                      // channels per curated feed id
 *   channelIdCache: { [urlOrHandle: string]: string }  // UC...
 * }
 */

import { DEFAULT_SETTINGS, getStarterChannels, LEGACY_FEED_ID_MAP, STARTERS_VERSION, FEED_IDS, FEED_META, RESERVED_FEED_IDS } from "./defaults.js";

const KEYS = {
  settings: "settings",
  feeds: "feeds",
  feedList: "feedList",
  channelIdCache: "channelIdCache",
};

function storageArea() {
  // Prefer sync; fall back to local if sync unavailable
  try {
    if (chrome?.storage?.sync) return chrome.storage.sync;
  } catch (_) {
    /* ignore */
  }
  return chrome.storage.local;
}

function get(keys) {
  return new Promise((resolve) => {
    try {
      storageArea().get(keys, (result) => {
        if (chrome.runtime.lastError) {
          chrome.storage.local.get(keys, resolve);
          return;
        }
        resolve(result || {});
      });
    } catch (_) {
      chrome.storage.local.get(keys, resolve);
    }
  });
}

function set(obj) {
  return new Promise((resolve, reject) => {
    try {
      storageArea().set(obj, () => {
        if (chrome.runtime.lastError) {
          chrome.storage.local.set(obj, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
          return;
        }
        resolve();
      });
    } catch (e) {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    }
  });
}

/** Starters: personal-feeds.local.json (gitignored, optional) overrides public defaults. */
export async function loadStarters() {
  const base = getStarterChannels();
  try {
    const res = await fetch(chrome.runtime.getURL("personal-feeds.local.json"), { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      for (const id of Object.keys(base)) if (Array.isArray(data[id])) base[id] = data[id];
    }
  } catch (_) { /* file absent */ }
  return base;
}

/** Ensure starters exist on first run. */
export async function ensureInitialized() {
  const data = await get([KEYS.settings, KEYS.feeds, KEYS.feedList]);
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  let feeds = data.feeds;
  let changed = false;

  if (!settings.feedsInitialized || !feeds) {
    feeds = await loadStarters();
    settings.feedsInitialized = true;
    settings.startersVersion = STARTERS_VERSION;
    changed = true;
  }

  // One-time reseed when starter lists ship a new version (keeps user edits after)
  if (settings.startersVersion !== STARTERS_VERSION) {
    feeds = await loadStarters();
    settings.feedsInitialized = true;
    settings.startersVersion = STARTERS_VERSION;
    changed = true;
  }

  // Migrate legacy feed ids (e.g. lore -> longform)
  for (const [oldId, newId] of Object.entries(LEGACY_FEED_ID_MAP)) {
    if (feeds && Object.prototype.hasOwnProperty.call(feeds, oldId)) {
      const merged = [...(feeds[newId] || [])];
      for (const c of feeds[oldId] || []) {
        if (!merged.some((m) => (c.channelId && m.channelId === c.channelId) || (c.handle && m.handle === c.handle))) merged.push(c);
      }
      feeds[newId] = merged;
      delete feeds[oldId];
      changed = true;
    }
  }

  // Ensure all feed keys exist
  const starters = await loadStarters();
  for (const id of Object.keys(starters)) {
    if (!feeds[id]) {
      feeds[id] = starters[id];
      changed = true;
    }
  }

  // Curated feed list (v1.6.0): migrate built-ins + any extra feed keys into an ordered list
  let feedList = Array.isArray(data.feedList) ? data.feedList.filter((f) => f && f.id) : null;
  if (!feedList) {
    feedList = FEED_IDS.map((id) => ({ ...FEED_META[id], builtin: true }));
    changed = true;
  }
  for (const id of Object.keys(feeds)) {
    if (RESERVED_FEED_IDS.includes(id)) continue;
    if (!feedList.some((f) => f.id === id)) {
      feedList.push(FEED_META[id] ? { ...FEED_META[id], builtin: true } : { id, name: id, icon: "📁", description: "", builtin: false });
      changed = true;
    }
  }
  for (const f of feedList) {
    if (!Array.isArray(feeds[f.id])) {
      feeds[f.id] = [];
      changed = true;
    }
  }

  if (changed) {
    await set({ [KEYS.settings]: settings, [KEYS.feeds]: feeds, [KEYS.feedList]: feedList });
  }

  return { settings, feeds, feedList };
}

export async function getSettings() {
  const { settings } = await ensureInitialized();
  return settings;
}

export async function saveSettings(partial) {
  const settings = await getSettings();
  const next = { ...settings, ...partial };
  await set({ [KEYS.settings]: next });
  return next;
}

export async function getFeeds() {
  const { feeds } = await ensureInitialized();
  return feeds;
}

export async function saveFeeds(feeds) {
  await set({ [KEYS.feeds]: feeds });
  return feeds;
}

/** Ordered curated feeds: [{ id, name, icon, description, builtin, channels }] */
export async function getCuratedFeeds() {
  const { feeds, feedList } = await ensureInitialized();
  return feedList.map((f) => ({ ...f, channels: feeds[f.id] || [] }));
}

export async function getFeedList() {
  const { feedList } = await ensureInitialized();
  return feedList;
}

export async function isCuratedFeedId(feedId) {
  return (await getFeedList()).some((f) => f.id === feedId);
}

function slugify(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "feed";
}

function cleanName(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!n) throw new Error("Feed name is required");
  return n;
}

export async function createFeed(name, icon) {
  const { feeds, feedList } = await ensureInitialized();
  const display = cleanName(name);
  if (feedList.some((f) => f.name.toLowerCase() === display.toLowerCase())) throw new Error(`A feed named "${display}" already exists`);
  const base = "c-" + slugify(display);
  let id = base;
  for (let i = 2; feedList.some((f) => f.id === id) || feeds[id] || RESERVED_FEED_IDS.includes(id); i++) id = `${base}-${i}`;
  const feed = { id, name: display, icon: (icon || "").trim() || "📁", description: "", builtin: false };
  feedList.push(feed);
  feeds[id] = [];
  await set({ [KEYS.feeds]: feeds, [KEYS.feedList]: feedList });
  return feed;
}

export async function renameFeed(feedId, name) {
  const { feedList } = await ensureInitialized();
  const feed = feedList.find((f) => f.id === feedId);
  if (!feed) throw new Error("Unknown feed");
  const display = cleanName(name);
  if (feedList.some((f) => f.id !== feedId && f.name.toLowerCase() === display.toLowerCase())) throw new Error(`A feed named "${display}" already exists`);
  feed.name = display;
  await set({ [KEYS.feedList]: feedList });
  return feed;
}

/** Delete a custom (non built-in) feed and its channels. */
export async function deleteFeed(feedId) {
  const { feeds, feedList } = await ensureInitialized();
  const feed = feedList.find((f) => f.id === feedId);
  if (!feed) throw new Error("Unknown feed");
  if (feed.builtin) throw new Error("Built-in feeds can be renamed but not deleted");
  const nextList = feedList.filter((f) => f.id !== feedId);
  delete feeds[feedId];
  await set({ [KEYS.feeds]: feeds, [KEYS.feedList]: nextList });
  return nextList;
}

export async function getFeedChannels(feedId) {
  const feeds = await getFeeds();
  return feeds[feedId] || [];
}

export async function setFeedChannels(feedId, channels) {
  const feeds = await getFeeds();
  feeds[feedId] = channels;
  await saveFeeds(feeds);
  return channels;
}

export async function addChannel(feedId, channel) {
  const channels = await getFeedChannels(feedId);
  // Dedupe by channelId or handle/url
  const exists = channels.some(
    (c) =>
      (channel.channelId && c.channelId === channel.channelId) ||
      (channel.handle && c.handle === channel.handle) ||
      (channel.url && c.url === channel.url)
  );
  if (exists) {
    return { channels, added: false, alreadyPresent: true };
  }
  channels.push({ ...channel, enabled: channel.enabled !== false });
  const next = await setFeedChannels(feedId, channels);
  return { channels: next, added: true, alreadyPresent: false };
}

/** Toggle or set enabled flag; missing enabled means true (legacy). */
export async function setChannelEnabled(feedId, index, enabled) {
  const channels = await getFeedChannels(feedId);
  if (index < 0 || index >= channels.length) throw new Error("Invalid channel index");
  channels[index] = { ...channels[index], enabled: !!enabled };
  return setFeedChannels(feedId, channels);
}

export function isChannelEnabled(ch) {
  return !ch || ch.enabled !== false;
}

export async function removeChannel(feedId, index) {
  const channels = await getFeedChannels(feedId);
  channels.splice(index, 1);
  return setFeedChannels(feedId, channels);
}

export async function getChannelIdCache() {
  const data = await get([KEYS.channelIdCache]);
  return data.channelIdCache || {};
}

export async function cacheChannelId(key, channelId) {
  const cache = await getChannelIdCache();
  cache[key] = channelId;
  await set({ [KEYS.channelIdCache]: cache });
  return channelId;
}

/** Reset built-in feed channels to starters. Keeps feed names and custom feeds (their channels are cleared). */
export async function resetToStarters() {
  const { feedList } = await ensureInitialized();
  const starters = await loadStarters();
  const feeds = {};
  for (const f of feedList) feeds[f.id] = starters[f.id] || [];
  const settings = { ...DEFAULT_SETTINGS, feedsInitialized: true, startersVersion: STARTERS_VERSION };
  await set({ [KEYS.settings]: settings, [KEYS.feeds]: feeds });
  return { settings, feeds, feedList };
}
