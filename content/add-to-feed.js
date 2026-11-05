/**
 * Inject "Add to curated feed" on YouTube channel / watch pages.
 * Persists via background ADD_CHANNEL into the same chrome.storage feeds as Settings.
 * Independent of the Shorts blocker.
 */
(function () {
  "use strict";

  // Curated feeds are loaded dynamically from the extension (custom names + user-created feeds).
  // Playlists / Algorithm are system tabs and never appear here.
  const FALLBACK_FEEDS = [
    { id: "longform", name: "Longform", icon: "📜" },
    { id: "ai-skills", name: "AI Skills", icon: "🤖" },
    { id: "games", name: "Games", icon: "🎮" },
    { id: "news", name: "News", icon: "📰" },
  ];

  const ROOT_ID = "yfn-add-feed-root";
  const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
  let lastKey = "";
  let menuOpen = false;
  let injectTimer = 0;
  let retries = 0;
  let resolveCache = { path: "", channel: null };

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false, error: "No response" });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });
  }

  function pageKind() {
    const path = location.pathname || "";
    if (/^\/watch/.test(path)) return "watch";
    if (/^\/channel\/UC[\w-]{22}/.test(path)) return "channel";
    if (/^\/@[\w.-]+/.test(path)) return "channel";
    if (/^\/(c|user)\/[^/]+/.test(path)) return "channel";
    return null;
  }

  function extractJsonAssign(source, varName, maxLen) {
    const idx = source.indexOf(varName);
    if (idx < 0) return null;
    const eq = source.indexOf("=", idx);
    if (eq < 0 || eq - idx > varName.length + 8) return null;
    let i = eq + 1;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== "{") return null;
    let depth = 0;
    const limit = Math.min(source.length, i + maxLen);
    for (let j = i; j < limit; j++) {
      const ch = source[j];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(i, j + 1));
          } catch (_) {
            return null;
          }
        }
      }
    }
    return null;
  }

  function readEmbedded(varName, maxLen) {
    try {
      if (varName === "ytInitialData" && window.ytInitialData) return window.ytInitialData;
      if (varName === "ytInitialPlayerResponse" && window.ytInitialPlayerResponse) {
        return window.ytInitialPlayerResponse;
      }
    } catch (_) {}
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      const t = s.textContent || "";
      if (!t.includes(varName)) continue;
      const obj = extractJsonAssign(t, varName, maxLen);
      if (obj) return obj;
    }
    return null;
  }

  function deepFind(obj, pred, max = 4000) {
    const seen = new Set();
    const stack = [obj];
    let n = 0;
    while (stack.length && n < max) {
      const cur = stack.pop();
      n++;
      if (!cur || typeof cur !== "object") continue;
      if (seen.has(cur)) continue;
      seen.add(cur);
      try {
        if (pred(cur)) return cur;
      } catch (_) {}
      if (Array.isArray(cur)) {
        for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
      } else {
        for (const k of Object.keys(cur)) stack.push(cur[k]);
      }
    }
    return null;
  }

  function resolveFromPage() {
    const path = location.pathname || "";
    if (resolveCache.path === path && resolveCache.channel) {
      return resolveCache.channel;
    }

    let channelId = "";
    let name = "";
    let handle = "";
    let url = "";

    const chPath = path.match(/\/channel\/(UC[\w-]{22})/);
    if (chPath) {
      channelId = chPath[1];
      url = `https://www.youtube.com/channel/${channelId}`;
    }
    const handlePath = path.match(/\/(@[\w.-]+)/);
    if (handlePath) {
      handle = handlePath[1];
      url = url || `https://www.youtube.com/${handle}`;
    }

    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical?.href) {
      const m = canonical.href.match(/\/channel\/(UC[\w-]{22})/);
      if (m) {
        channelId = channelId || m[1];
        url = url || `https://www.youtube.com/channel/${m[1]}`;
      }
      const h = canonical.href.match(/\/(@[\w.-]+)/);
      if (h) {
        handle = handle || h[1];
        url = url || `https://www.youtube.com/${h[1]}`;
      }
    }

    const metaCh = document.querySelector('meta[itemprop="channelId"]');
    if (metaCh?.content && CHANNEL_ID_RE.test(metaCh.content)) {
      channelId = channelId || metaCh.content;
    }

    // Lightweight regex scan of early scripts for externalId / channelId near metadata
    if (!channelId) {
      for (const s of document.querySelectorAll("script")) {
        const t = s.textContent || "";
        if (t.length < 200 || t.length > 3_000_000) continue;
        let m =
          t.match(/"externalId"\s*:\s*"(UC[\w-]{22})"/) ||
          t.match(/"channelId"\s*:\s*"(UC[\w-]{22})"/);
        if (m) {
          channelId = m[1];
          break;
        }
      }
    }

    const data = readEmbedded("ytInitialData", 4_000_000);
    if (data) {
      const meta =
        data?.metadata?.channelMetadataRenderer ||
        deepFind(data, (o) => o.channelMetadataRenderer)?.channelMetadataRenderer;
      if (meta) {
        if (meta.externalId && CHANNEL_ID_RE.test(meta.externalId)) {
          channelId = channelId || meta.externalId;
        }
        name = name || meta.title || "";
        if (meta.vanityChannelUrl) {
          const h = String(meta.vanityChannelUrl).match(/(@[\w.-]+)/);
          if (h) handle = handle || h[1];
          url = url || meta.vanityChannelUrl;
        }
        if (meta.channelUrl) url = url || meta.channelUrl;
      }

      const header = data?.header?.c4TabbedHeaderRenderer;
      if (header) {
        if (header.channelId && CHANNEL_ID_RE.test(header.channelId)) {
          channelId = channelId || header.channelId;
        }
        name = name || (typeof header.title === "string" ? header.title : "") || "";
      }

      const ownerNode = deepFind(data, (o) => o.videoOwnerRenderer);
      const videoOwner = ownerNode?.videoOwnerRenderer;
      if (videoOwner) {
        const browse =
          videoOwner?.navigationEndpoint?.browseEndpoint?.browseId ||
          videoOwner?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
        if (browse && CHANNEL_ID_RE.test(browse)) channelId = channelId || browse;
        const t =
          videoOwner?.title?.runs?.[0]?.text ||
          videoOwner?.title?.simpleText ||
          "";
        name = name || t;
        const base =
          videoOwner?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ||
          videoOwner?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ||
          "";
        const hm = String(base).match(/(@[\w.-]+)/);
        if (hm) handle = handle || hm[1];
      }
    }

    if (!channelId || !name) {
      const player = readEmbedded("ytInitialPlayerResponse", 1_500_000);
      const vd = player?.videoDetails;
      if (vd) {
        if (vd.channelId && CHANNEL_ID_RE.test(vd.channelId)) {
          channelId = channelId || vd.channelId;
        }
        name = name || vd.author || "";
      }
    }

    if (!channelId || !name || !handle) {
      const ownerLink =
        document.querySelector("#owner #channel-name a") ||
        document.querySelector("ytd-video-owner-renderer a[href]") ||
        document.querySelector("#upload-info a[href*='/@']") ||
        document.querySelector("#upload-info a[href*='/channel/']") ||
        document.querySelector("ytd-channel-name a[href]");
      if (ownerLink) {
        const href = ownerLink.getAttribute("href") || "";
        const idm = href.match(/\/channel\/(UC[\w-]{22})/);
        if (idm) channelId = channelId || idm[1];
        const hm = href.match(/\/(@[\w.-]+)/);
        if (hm) handle = handle || hm[1];
        name = name || (ownerLink.textContent || "").trim();
        if (!url && href) {
          url = href.startsWith("http") ? href : `https://www.youtube.com${href}`;
        }
      }
    }

    if (!name) {
      const titleEl =
        document.querySelector("#page-header yt-dynamic-text-view-model") ||
        document.querySelector("ytd-channel-name #text") ||
        document.querySelector("#channel-name #text");
      if (titleEl) name = (titleEl.textContent || "").trim();
    }
    if (!name) {
      const og = document.querySelector('meta[property="og:title"]');
      if (og?.content) name = og.content.replace(/\s*-\s*YouTube\s*$/i, "").trim();
    }

    // On watch pages, og:title is the video — strip if we already have author
    if (/^\/watch/.test(path) && name && name.length > 80) {
      // Prefer shorter owner name from DOM if available
    }

    if (!url) {
      if (handle) url = `https://www.youtube.com/${handle}`;
      else if (channelId) url = `https://www.youtube.com/channel/${channelId}`;
    }

    if (!channelId && !handle && !url) {
      resolveCache = { path, channel: null };
      return null;
    }

    const channel = {
      channelId: channelId || "",
      name: name || (handle ? handle.replace(/^@/, "") : "") || channelId || "Channel",
      handle: handle || "",
      url: url || "",
    };
    resolveCache = { path, channel };
    return channel;
  }

  function showToast(text, kind) {
    let toast = document.getElementById("yfn-add-feed-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "yfn-add-feed-toast";
      toast.className = "yfn-add-feed-toast";
      (document.body || document.documentElement).appendChild(toast);
    }
    toast.textContent = text;
    toast.dataset.kind = kind || "";
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function closeMenu() {
    menuOpen = false;
    const menu = document.querySelector(`#${ROOT_ID} .yfn-add-feed-menu`);
    if (menu) menu.hidden = true;
    const btn = document.querySelector(`#${ROOT_ID} .yfn-add-feed-btn`);
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function findAnchor() {
    const kind = pageKind();
    if (!kind) return null;

    if (kind === "channel") {
      const candidates = [
        document.querySelector("#channel-header #buttons"),
        document.querySelector("#inner-header-container #buttons"),
        document.querySelector("ytd-c4-tabbed-header-renderer #buttons"),
        document.querySelector("#page-header yt-flexible-actions-view-model"),
        document.querySelector("yt-flexible-actions-view-model"),
        document.querySelector("#channel-header-container #buttons"),
        document.querySelector("ytd-subscribe-button-renderer")?.parentElement,
      ];
      for (const el of candidates) {
        if (el && el.isConnected) return { el, kind: "channel" };
      }
      return null;
    }

    const candidates = [
      document.querySelector("#owner"),
      document.querySelector("ytd-watch-metadata #owner"),
      document.querySelector("ytd-video-owner-renderer"),
      document.querySelector("#upload-info"),
    ];
    for (const el of candidates) {
      if (el && el.isConnected) return { el, kind: "watch" };
    }
    return null;
  }

  async function onPickFeed(feedId, feedName) {
    closeMenu();
    resolveCache = { path: "", channel: null }; // refresh
    const channel = resolveFromPage();
    if (!channel) {
      showToast("Could not identify this channel", "error");
      return;
    }
    showToast(`Adding to ${feedName}…`, "");
    const res = await send({ type: "ADD_CHANNEL", feedId, channel });
    if (!res.ok) {
      showToast(res.error || "Failed to add channel", "error");
      return;
    }
    const label = res.channel?.name || channel.name || "Channel";
    if (res.alreadyPresent) {
      showToast(`Already in ${feedName}`, "info");
      return;
    }
    showToast(`Added ${label} to ${feedName}`, "ok");
  }

  function buildUi() {
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "yfn-add-feed-root";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "yfn-add-feed-btn";
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.title = "Add this channel to a curated feed";
    btn.innerHTML =
      '<span class="yfn-add-feed-icon" aria-hidden="true">＋</span>' +
      '<span class="yfn-add-feed-label">Add to curated feed</span>';

    const menu = document.createElement("div");
    menu.className = "yfn-add-feed-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    function fillMenu(feeds) {
      menu.textContent = "";
      for (const f of feeds) {
        if (f.id === "algorithm" || f.id === "playlists") continue;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "yfn-add-feed-item";
        item.setAttribute("role", "menuitem");
        item.dataset.feedId = f.id;
        const icon = document.createElement("span");
        icon.className = "yfn-add-feed-item-icon";
        icon.textContent = f.icon || "📁";
        const label = document.createElement("span");
        label.textContent = f.name;
        item.append(icon, label);
        item.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onPickFeed(f.id, f.name);
        });
        menu.appendChild(item);
      }
    }
    fillMenu(FALLBACK_FEEDS);
    const refreshMenu = () =>
      send({ type: "GET_CURATED_FEEDS" }).then((res) => {
        if (res.ok && Array.isArray(res.feeds)) fillMenu(res.feeds);
      });
    refreshMenu();

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!menuOpen) refreshMenu();
      menuOpen = !menuOpen;
      menu.hidden = !menuOpen;
      btn.setAttribute("aria-expanded", menuOpen ? "true" : "false");
    });

    root.appendChild(btn);
    root.appendChild(menu);
    return root;
  }

  function inject() {
    const kind = pageKind();
    const existing = document.getElementById(ROOT_ID);
    if (!kind) {
      if (existing) existing.remove();
      lastKey = "";
      retries = 0;
      return;
    }

    const channel = resolveFromPage();
    const key = `${kind}|${location.pathname}|${channel?.channelId || channel?.handle || ""}`;
    const anchor = findAnchor();
    if (!anchor) {
      if (retries < 40) {
        retries += 1;
        scheduleInject(400);
      }
      return;
    }
    retries = 0;

    if (existing && lastKey === key && existing.isConnected) return;
    if (existing) existing.remove();

    const ui = buildUi();
    ui.classList.add(kind === "channel" ? "yfn-add-feed-root--channel" : "yfn-add-feed-root--watch");
    anchor.el.appendChild(ui);
    lastKey = key;
    menuOpen = false;
  }

  function scheduleInject(delay) {
    clearTimeout(injectTimer);
    injectTimer = setTimeout(inject, delay == null ? 200 : delay);
  }

  function onNavigate() {
    resolveCache = { path: "", channel: null };
    lastKey = "";
    retries = 0;
    scheduleInject(300);
  }

  document.addEventListener(
    "click",
    (e) => {
      if (!menuOpen) return;
      const root = document.getElementById(ROOT_ID);
      if (root && !root.contains(e.target)) closeMenu();
    },
    true
  );

  document.addEventListener("yt-navigate-finish", onNavigate);
  document.addEventListener("yt-page-data-updated", onNavigate);
  window.addEventListener("popstate", onNavigate);

  // Soft observer: only while button missing on a relevant page
  const mo = new MutationObserver(() => {
    if (!pageKind()) return;
    if (document.getElementById(ROOT_ID)?.isConnected) return;
    scheduleInject(250);
  });

  function start() {
    try {
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
    scheduleInject(100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
