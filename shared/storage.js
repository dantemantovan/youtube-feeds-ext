/**
 * chrome.storage.sync with local fallback.
 * Shape:
 * {
 *   settings: { hideShorts: boolean, feedsInitialized: boolean },
 *   feeds: { longform: Channel[], "ai-skills": Channel[], games: Channel[], news: Channel[] },
 *   channelIdCache: { [urlOrHandle: string]: string }  // UC...
 * }
 */

import { DEFAULT_SETTINGS, getStarterChannels, LEGACY_FEED_ID_MAP, STARTERS_VERSION } from "./defaults.js";

const KEYS = {
  settings: "settings",
  feeds: "feeds",
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
  const data = await get([KEYS.settings, KEYS.feeds]);
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

  if (changed) {
    await set({ [KEYS.settings]: settings, [KEYS.feeds]: feeds });
  }

  return { settings, feeds };
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
  if (exists) return channels;
  channels.push(channel);
  return setFeedChannels(feedId, channels);
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

export async function resetToStarters() {
  const feeds = await loadStarters();
  const settings = { ...DEFAULT_SETTINGS, feedsInitialized: true, startersVersion: STARTERS_VERSION };
  await set({ [KEYS.settings]: settings, [KEYS.feeds]: feeds });
  return { settings, feeds };
}
