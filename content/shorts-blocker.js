/**
 * Hide YouTube Shorts shelves/tiles and redirect /shorts/VIDEO → /watch?v=VIDEO.
 * Re-runs on SPA navigation (yt-navigate-finish + MutationObserver).
 */
(function () {
  "use strict";

  const STATE = {
    hideShorts: true,
    observer: null,
    scheduled: false,
  };

  function applyClass() {
    document.documentElement.classList.toggle("yfn-hide-shorts", !!STATE.hideShorts);
  }

  function shortsIdFromPath(pathname) {
    const m = (pathname || "").match(/^\/shorts\/([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : null;
  }

  function redirectShortsIfNeeded() {
    if (!STATE.hideShorts) return;
    const id = shortsIdFromPath(location.pathname);
    if (!id) {
      document.body && document.body.classList.remove("yfn-shorts-blocked");
      return;
    }
    // Prefer watch page over vertical player
    const target = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    if (location.href !== target) {
      location.replace(target);
    } else {
      document.body && document.body.classList.add("yfn-shorts-blocked");
    }
  }

  function markShortNodes(root) {
    if (!STATE.hideShorts) return;
    const scope = root && root.querySelectorAll ? root : document;

    // Anchors pointing at Shorts
    const anchors = scope.querySelectorAll
      ? scope.querySelectorAll('a[href*="/shorts/"]')
      : [];
    anchors.forEach((a) => {
      const host =
        a.closest(
          "ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer, ytd-shorts-lockup-view-model, shorts-lockup-view-model, ytm-shorts-lockup-view-model, grid-shelf-view-model > *, ytd-rich-shelf-renderer, ytd-reel-shelf-renderer"
        ) || a;
      host.classList.add("yfn-is-short");
    });

    // Badge text "SHORTS" / overlays
    const badges = scope.querySelectorAll
      ? scope.querySelectorAll(
          "ytd-thumbnail-overlay-time-status-renderer, .badge-style-type-overlays, span#text"
        )
      : [];
    badges.forEach((el) => {
      const t = (el.textContent || "").trim().toUpperCase();
      if (t === "SHORTS" || t === "SHORT") {
        const host = el.closest(
          "ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer"
        );
        if (host) host.classList.add("yfn-is-short");
      }
    });
  }

  function sweep() {
    STATE.scheduled = false;
    applyClass();
    redirectShortsIfNeeded();
    if (STATE.hideShorts) markShortNodes(document);
  }

  function scheduleSweep() {
    if (STATE.scheduled) return;
    STATE.scheduled = true;
    requestAnimationFrame(sweep);
  }

  function startObserver() {
    if (STATE.observer) return;
    STATE.observer = new MutationObserver((mutations) => {
      if (!STATE.hideShorts) return;
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) {
          scheduleSweep();
          return;
        }
      }
    });
    const start = () => {
      if (document.documentElement) {
        STATE.observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      }
    };
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }

  function onNavigate() {
    scheduleSweep();
  }

  // yt SPA events
  window.addEventListener("yt-navigate-finish", onNavigate, true);
  window.addEventListener("yt-page-data-updated", onNavigate, true);
  window.addEventListener("popstate", onNavigate, true);

  // Early path intercept via history hooks (lightweight)
  const wrapHistory = (method) => {
    const orig = history[method];
    history[method] = function () {
      const ret = orig.apply(this, arguments);
      scheduleSweep();
      return ret;
    };
  };
  try {
    wrapHistory("pushState");
    wrapHistory("replaceState");
  } catch (_) {
    /* ignore */
  }

  // Settings from background / storage
  function loadSettings() {
    try {
      chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (res) => {
        if (chrome.runtime.lastError) {
          // Fallback: read storage directly
          chrome.storage.sync.get({ settings: { hideShorts: true } }, (data) => {
            const s = data.settings || { hideShorts: true };
            STATE.hideShorts = s.hideShorts !== false;
            scheduleSweep();
          });
          return;
        }
        if (res && res.ok && res.settings) {
          STATE.hideShorts = res.settings.hideShorts !== false;
        }
        scheduleSweep();
      });
    } catch (_) {
      STATE.hideShorts = true;
      scheduleSweep();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "SETTINGS_UPDATED" && msg.settings) {
      STATE.hideShorts = msg.settings.hideShorts !== false;
      scheduleSweep();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" && area !== "local") return;
    if (changes.settings && changes.settings.newValue) {
      STATE.hideShorts = changes.settings.newValue.hideShorts !== false;
      scheduleSweep();
    }
  });

  // Boot ASAP
  applyClass();
  startObserver();
  loadSettings();
  scheduleSweep();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleSweep, { once: true });
  }
})();
