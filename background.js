import { registerEmbedReferer, prepareEmbed } from "./shared/embed.js";
import { getDurations, views as viewCounts } from "./shared/duration.js";
/**
 * Service worker: open feeds page on action click; message handlers for
 * RSS fetch / channel resolve / settings broadcast.
 */

import {
  ensureInitialized,
  getSettings,
  saveSettings,
  getFeedChannels,
  getFeeds,
  setFeedChannels,
  addChannel,
  removeChannel,
  setChannelEnabled,
  isChannelEnabled,
  resetToStarters,
  getCuratedFeeds,
  isCuratedFeedId,
  createFeed,
  renameFeed,
  deleteFeed,
} from "./shared/storage.js";
import { resolveChannelId, buildChannelFromInput, parseChannelInput } from "./shared/resolve.js";
import { getChannelVideos, mergeAndSort } from "./shared/rss.js";
import {
  getPlaylists, setPlaylists, addPlaylists, removePlaylist,
  refreshPlaylists, getPlaylistVideos, parsePlaylistId,
  setPlaylistEnabled, isPlaylistEnabled,
} from "./shared/playlists.js";
import { fetchAlgorithmFeed } from "./shared/algorithm.js";

registerEmbedReferer().catch((e) => console.warn("embed referer rule failed", e));

chrome.runtime.onInstalled.addListener(() => {
  ensureInitialized().catch((e) => console.warn("init failed", e));
});

chrome.runtime.onStartup.addListener(() => {
  ensureInitialized().catch(() => {});
});

// Action button opens the feeds UI (full page, not popup)
// Never navigates the current tab: focus an existing Feeds tab, else open a new one beside it.
const YT_ORIGINS = { origins: ["https://www.youtube.com/*", "https://youtube.com/*", "https://www.youtube-nocookie.com/*"] };

chrome.action.onClicked.addListener(async (tab) => {
  // Firefox treats MV3 host permissions as user-grantable/optional. Request them from this
  // user gesture (must be called before any await) so feeds, Algorithm, and Playlists can fetch.
  try {
    if (chrome.permissions?.request) chrome.permissions.request(YT_ORIGINS).catch(() => {});
  } catch (_) {}
  const url = chrome.runtime.getURL("feeds.html");
  let existing = null;
  try {
    // getContexts finds our own feeds tab without needing the "tabs" permission (Chromium)
    const ctx = await chrome.runtime.getContexts({ contextTypes: ["TAB"], documentUrls: [url] });
    if (ctx[0]?.tabId > 0) existing = { id: ctx[0].tabId, windowId: ctx[0].windowId };
  } catch (_) {}
  if (!existing) {
    // Firefox fallback: background is an event page, so extension tab views are reachable.
    try {
      const views = chrome.extension?.getViews?.({ type: "tab" }) || [];
      for (const v of views) {
        if (!v.location.href.startsWith(url)) continue;
        const t = await v.chrome.tabs.getCurrent();
        if (t?.id) { existing = { id: t.id, windowId: t.windowId }; break; }
      }
    } catch (_) {}
  }
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  chrome.tabs.create({ url, active: true, index: tab?.index != null ? tab.index + 1 : undefined, openerTabId: tab?.id });
});

/**
 * Broadcast settings to all youtube tabs (for Shorts toggle).
 */
async function broadcastSettings() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({
    url: ["*://www.youtube.com/*", "*://youtube.com/*"],
  });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "SETTINGS_UPDATED",
        settings,
      });
    } catch (_) {
      /* content script may not be ready */
    }
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" && area !== "local") return;
  if (changes.settings) {
    broadcastSettings().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true; // async
});

async function handleMessage(msg) {
  if (!msg || !msg.type) return { ok: false, error: "No message type" };

  switch (msg.type) {
    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { ok: true, settings };
    }
    case "SAVE_SETTINGS": {
      const settings = await saveSettings(msg.settings || {});
      await broadcastSettings();
      return { ok: true, settings };
    }
    case "GET_FEEDS_META": {
      await ensureInitialized();
      const list = await getCuratedFeeds();
      const meta = {};
      for (const f of list) meta[f.id] = { id: f.id, name: f.name, icon: f.icon, description: f.description, builtin: !!f.builtin };
      return { ok: true, feedIds: list.map((f) => f.id), meta, feeds: Object.fromEntries(list.map((f) => [f.id, f.channels])) };
    }
    case "GET_CURATED_FEEDS": {
      const list = await getCuratedFeeds();
      return { ok: true, feeds: list.map(({ channels, ...f }) => ({ ...f, channelCount: channels.length })) };
    }
    case "CREATE_FEED": {
      const feed = await createFeed(msg.name, msg.icon);
      return { ok: true, feed };
    }
    case "RENAME_FEED": {
      const feed = await renameFeed(msg.feedId, msg.name);
      return { ok: true, feed };
    }
    case "DELETE_FEED": {
      const feeds = await deleteFeed(msg.feedId);
      return { ok: true, feeds };
    }
    case "GET_FEED_CHANNELS": {
      const channels = await getFeedChannels(msg.feedId);
      return { ok: true, channels };
    }
    case "SET_FEED_CHANNELS": {
      const channels = await setFeedChannels(msg.feedId, msg.channels || []);
      return { ok: true, channels };
    }
    case "ADD_CHANNEL": {
      if (!(await isCuratedFeedId(msg.feedId))) {
        return { ok: false, error: "Invalid feed (curated feeds only)" };
      }
      let channel;
      if (msg.channel && (msg.channel.channelId || msg.channel.handle || msg.channel.url)) {
        // Pre-resolved from page UI — still resolve missing UC id when needed
        const raw =
          msg.channel.channelId ||
          msg.channel.handle ||
          msg.channel.url ||
          msg.input ||
          "";
        channel = await buildChannelFromInput(raw, msg.channel.name || msg.name || "");
        // Prefer page-provided display name / handle / url when present
        if (msg.channel.name) channel.name = msg.channel.name;
        if (msg.channel.handle) channel.handle = msg.channel.handle;
        if (msg.channel.url) channel.url = msg.channel.url;
        if (msg.channel.channelId && /^UC[\w-]{22}$/.test(msg.channel.channelId)) {
          channel.channelId = msg.channel.channelId;
        }
        channel.enabled = true;
      } else {
        channel = await buildChannelFromInput(msg.input, msg.name || "");
        channel.enabled = true;
      }
      const result = await addChannel(msg.feedId, channel);
      return {
        ok: true,
        channel,
        channels: result.channels,
        added: result.added,
        alreadyPresent: result.alreadyPresent,
      };
    }
    case "REMOVE_CHANNEL": {
      const channels = await removeChannel(msg.feedId, msg.index);
      return { ok: true, channels };
    }
    case "SET_CHANNEL_ENABLED": {
      const channels = await setChannelEnabled(msg.feedId, msg.index, msg.enabled !== false);
      return { ok: true, channels };
    }
    case "RESET_STARTERS": {
      const data = await resetToStarters();
      return { ok: true, ...data };
    }
    case "RESOLVE_CHANNEL": {
      const channelId = await resolveChannelId(msg.channel || parseChannelInput(msg.input));
      return { ok: true, channelId };
    }
    case "FETCH_FEED": {
      return fetchFeed(msg.feedId);
    }
    case "GET_DURATIONS": {
      const durations = await getDurations((msg.ids || []).slice(0, 100), 4, msg.viewIds || []);
      const views = {};
      for (const id of msg.ids || []) if (viewCounts[id] != null) views[id] = viewCounts[id];
      return { ok: true, durations, views };
    }
    case "GET_PLAYLISTS": {
      let list = await getPlaylists();
      if (!list.length) list = (await refreshPlaylists()).list; // pick up playlists.local.json
      return { ok: true, playlists: list };
    }
    case "REFRESH_PLAYLISTS": {
      const r = await refreshPlaylists({ scrape: !!msg.scrape });
      return { ok: true, playlists: r.list, added: r.added, errors: r.errors };
    }
    case "IMPORT_PLAYLISTS": {
      const playlists = msg.replace ? await setPlaylists(msg.playlists || []) : await addPlaylists(msg.playlists || []);
      return { ok: true, playlists };
    }
    case "ADD_PLAYLIST": {
      const playlistId = parsePlaylistId(msg.input);
      if (!playlistId) return { ok: false, error: "Not a playlist URL or ID" };
      let name = msg.name || "";
      if (!name) { try { name = (await getPlaylistVideos(playlistId)).title; } catch (_) {} }
      const playlists = await addPlaylists([{ playlistId, name: name || playlistId }]);
      return { ok: true, playlists };
    }
    case "REMOVE_PLAYLIST": {
      return { ok: true, playlists: await removePlaylist(msg.playlistId) };
    }
    case "SET_PLAYLIST_ENABLED": {
      const playlists = await setPlaylistEnabled(msg.playlistId, msg.enabled !== false);
      return { ok: true, playlists };
    }
    case "FETCH_PLAYLIST": {
      const { title, videos } = await getPlaylistVideos(msg.playlistId);
      return { ok: true, title, videos };
    }
    case "FETCH_ALGORITHM": {
      return fetchAlgorithmFeed({ force: !!msg.force });
    }
    case "PREPARE_EMBED":
      return prepareEmbed();
    case "PING":
      return { ok: true, pong: true };
    default:
      return { ok: false, error: `Unknown type: ${msg.type}` };
  }
}

async function fetchFeed(feedId) {
  const allChannels = await getFeedChannels(feedId);
  const channels = allChannels.filter(isChannelEnabled);
  if (!allChannels.length) {
    return { ok: true, videos: [], errors: [], empty: true };
  }
  if (!channels.length) {
    return { ok: true, videos: [], errors: [], empty: false, allDisabled: true };
  }

  const lists = [];
  const errors = [];

  // Resolve missing IDs, then fetch RSS in parallel (bounded)
  const resolved = [];
  for (const ch of channels) {
    try {
      let channelId = ch.channelId;
      if (!channelId || !/^UC[\w-]{22}$/.test(channelId)) {
        channelId = await resolveChannelId(ch);
        // Persist resolved id back into feed
        ch.channelId = channelId;
      }
      resolved.push({ ...ch, channelId });
    } catch (e) {
      errors.push({ channel: ch.name || ch.handle || ch.url, error: String(e.message || e) });
    }
  }

  // Persist any newly resolved IDs onto the full list (keep disabled channels)
  if (resolved.length) {
    const updated = allChannels.map((c) => {
      const match = resolved.find(
        (r) =>
          (c.handle && r.handle === c.handle) ||
          (c.url && r.url === c.url) ||
          (c.channelId && r.channelId === c.channelId) ||
          (c.name && r.name === c.name)
      );
      return match ? { ...c, channelId: match.channelId } : c;
    });
    await setFeedChannels(feedId, updated);
  }

  const results = await Promise.allSettled(
    resolved.map((ch) => getChannelVideos(ch.channelId))
  );

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      // Prefer stored display name over RSS author when present
      const name = resolved[i].name;
      lists.push(
        r.value.map((v) => ({
          ...v,
          author: name || v.author,
        }))
      );
    } else {
      errors.push({
        channel: resolved[i].name || resolved[i].handle,
        error: String(r.reason?.message || r.reason),
      });
    }
  });

  const videos = mergeAndSort(lists);
  return { ok: true, videos, errors, empty: videos.length === 0 && channels.length === 0 };
}

// Warm init
ensureInitialized().catch(() => {});
