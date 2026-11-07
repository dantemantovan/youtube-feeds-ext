# YouTube Feeds + No Shorts

Manifest V3 extension for Chromium browsers (Chrome, Edge, Brave) and **Firefox 140+** that:

1. **Hides YouTube Shorts** everywhere on `youtube.com` (shelves, tab/chip, tiles, related; redirects `/shorts/VIDEO_ID` → `/watch?v=VIDEO_ID`)
2. Provides **curated feeds** — four built-ins (**Longform**, **AI Skills**, **Games**, **News**) that you can **rename**, plus unlimited **custom feeds** you create — add channels from Settings or via **Add to curated feed** on youtube.com
3. Adds an **Algorithm** tab that scrapes your signed-in YouTube Home into the same video cards (no API key, stays inside the extension)
4. Shows **Playlists** with YouTube-like playlist cards and the same video cards as other feeds

No Google API key. Curated feeds use YouTube’s public channel RSS. Algorithm uses a Home page scrape with your browser cookies. No analytics, no remote code.

---

## Build (v1.7.4)

`manifest.json` in the repo is the Chromium manifest. Run `node scripts/build.mjs` (Node 18+, Python 3) to produce:

| Output | Use |
|---|---|
| `dist/chromium/` and `dist/youtube-feeds-ext-<version>-chromium.zip` | Chrome / Edge / Brave (`background.service_worker`) |
| `dist/firefox/` and `dist/youtube-feeds-ext-<version>-firefox.zip` | Firefox (`background.scripts`, add-on ID `youtube-feeds-ext@dantemantovan`, `data_collection_permissions: none`) |

Check the Firefox build with `npx web-ext lint -s dist/firefox`.

## Firefox

Requires **Firefox 140 or newer** on desktop (the first version that supports the `data_collection_permissions` declaration). The manifest gives Firefox for Android a minimum of 142, but Android has **not** been tested.

**Temporary install (unsigned, removed when Firefox restarts):**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `dist/firefox/manifest.json` (or `youtube-feeds-ext-<version>-firefox.zip`).
3. Click the toolbar icon once. If Firefox asks, **allow access to youtube.com**. Firefox lets users grant or withhold MV3 host permissions, and feeds, Algorithm, Playlists, Add to curated feed, and the Shorts blocker all need youtube.com access. You can also grant it from `about:addons` → the extension → **Permissions**.

**Permanent install:** standard Firefox releases only keep add-ons signed by Mozilla. Upload the Firefox zip to addons.mozilla.org as an *unlisted* add-on (or use `web-ext sign --channel=unlisted`), then install the `.xpi` you get back.

**Data collection:** declared as `none`. The extension sends no data to the developer or any third party. Its only network requests go to youtube.com to fetch your feeds, Home recommendations, and playlists, using your existing YouTube login in that browser.

Feeds and playlists are stored separately in each browser and are not copied over from Chromium. Use Settings → Playlists **Import JSON**, or re-add your channels.

**Rendering:** pages are built with DOM APIs and `textContent` (`shared/dom.js`). Text from YouTube is never parsed as HTML, and only http(s) or relative URLs are used for links and images.

---

## Load unpacked (Chrome, Edge, or Brave on Windows)

1. Open Chrome or Edge.
2. Go to `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select this folder:

   ```
   …\youtube-feeds-ext
   ```

   (the folder that contains `manifest.json`)

6. Pin the extension if you like. Click the toolbar icon to open the Feeds page.

To update after editing files: on the extensions page, click the refresh icon on the card.

---

## Using the feeds

- Toolbar action → opens **Feeds** (`feeds.html`) with tabs: your curated feeds (built-ins + custom, using your names) · **Algorithm** · Playlists.
- Focusing the toolbar icon focuses an existing Feeds tab when one is already open (does not navigate your current tab away).
- Upgrading from an older version: a stored `lore` feed is automatically migrated to `longform` on load (your channels are kept), and a missing `news` feed is filled from starters.
- Each video card shows thumbnail, duration badge, title, channel, views/time; a normal click (or Enter) opens an **inline player** below that card's row, so you stay in your feed (v1.7.4). Clicking another video moves the player; ✕ Close or Esc stops it, as does switching feeds. Ctrl/Cmd-click or middle-click opens the video on YouTube in a new tab, and the player has an **Open on YouTube** link.
- Shorts RSS entries (`/shorts/…`) are filtered out.
- **Hide Shorts** toggle (default ON) is on the Feeds header and in Settings.
- **Settings** (gear) opens in a new tab → add channels per feed, enable/disable channels and playlists, or **Reset starters**.

### Inline player and privacy (v1.7.4)

The inline player is YouTube's official embedded player (`https://www.youtube.com/embed/VIDEO_ID`), so the video streams from YouTube and YouTube sees that request, just like any embedded video. No data goes to the developer.

Extension pages don't send an HTTP `Referer`, and without one YouTube's embed shows **Error 153**. YouTube's [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality#set-the-referer) terms tell apps in this situation to identify themselves with `Referer: https://<app id>`. The extension does this with one `declarativeNetRequest` session rule (`declarativeNetRequestWithHostAccess` permission, which only works with the youtube.com access the extension already has). The rule applies only to `www.youtube.com/embed/` frames opened by the extension's own pages. Firefox sends `https://youtube-feeds-ext.dantemantovan/`; Chromium sends `https://youtube-feeds-no-shorts.<extension id>/`.

Before adding the player, v1.7.4 checks that youtube.com access is granted and the identification rule is active. If access is missing, the player shows **Allow youtube.com access** and does not load (otherwise YouTube would show error 153). Under each player, **Player diagnostics** shows the version, access, rule state and Referer value; include it when reporting a problem.

Some videos still won't play inline: the uploader may have disabled embedding, or the video may need sign-in or an age check. Use **Open on YouTube** for those.

### Algorithm tab (v1.4.0)

**Algorithm** approximates YouTube Home recommendations **inside the Feeds UI**:

1. The extension fetches `https://www.youtube.com/` with cookies from this browser profile.
2. It parses Home rich-grid / lockup video renderers (`videoId`, title, channel, thumb, length, view count when present).
3. Results render as the **same cards** as other feeds. It does **not** navigate to or embed YouTube Home.
4. Last scrape is cached briefly in `chrome.storage.local` (~5 minutes). **↻ Refresh** forces a new scrape.
5. Default sort for this tab is **Recommended (Home order)**; newest/oldest/popular still work when metadata allows.

If you are signed out of YouTube in this profile (or Home cannot be parsed), the tab shows an empty state with a Sync/Refresh button.

### Create, rename, and delete curated feeds (v1.6.0)

In **Settings → Feed channels**, below the feed tabs:

- **＋ New feed** — prompts for a name and creates an empty curated feed (e.g. "Cooking"). Add channels with the form below or via **Add to curated feed** on YouTube.
- **✎ Rename feed** (or double-click a feed tab) — renames the selected feed. Works for built-ins too (e.g. Longform → "Deep Dives"); the id stays stable so channels and sort prefs are kept.
- **Delete feed** — shown only for custom feeds; asks for confirmation. Built-ins can be renamed but not deleted.

Names must be unique (case-insensitive, max 40 chars). Algorithm and Playlists are system tabs and are not curated feeds.

**Storage (v1.6.0):** `feedList` = ordered `[{ id, name, icon, description, builtin }]`; `feeds` = `{ [id]: Channel[] }`. On first load after upgrading, the four built-ins (`longform`, `ai-skills`, `games`, `news`) are written into `feedList` with their channels untouched; any other non-system key already in `feeds` is adopted as a custom feed. New feeds get ids like `c-cooking` (`-2`, `-3` on collision). **Reset starters** reseeds built-in channels, keeps names and custom feeds (custom feeds are emptied).

### Add to curated feed from YouTube (v1.5.0)

On normal **channel** pages (and **watch** pages when the channel is identifiable), the extension injects an **Add to curated feed** control near the subscribe / channel-header actions (watch: near the channel name).

- Opens a small menu listing **all your curated feeds** (built-ins with your names + custom feeds, loaded live from storage) — never Playlists or Algorithm.
- Choosing a feed resolves the channel id (`UC…`) and title from the page (`ytInitialData`, meta/canonical, URL, or owner link), then saves into the same `chrome.storage` `feeds` structure Settings uses (`enabled: true`).
- If the channel is already in that feed, a toast says so (no duplicate). Adding to another feed only adds there (does not remove from others).
- Personal lists stay out of git: page adds go to storage, not `personal-feeds.local.json`.

### Adding a channel

In Settings, pick a feed tab, then enter any of:

- `@handle` (e.g. `@Caedrel`)
- Channel URL (`https://www.youtube.com/@Caedrel` or `/channel/UC…`)
- Channel ID (`UC…`)

Optional display name. The extension fetches the channel page once, caches the `UC…` id, then pulls RSS.

### Enable / disable (v1.4.0)

In Settings, channels and playlists use an **On/Off toggle** instead of Remove. Disabled items stay in the list (dimmed) but are excluded from feed merges and the Playlists tab. The flag is stored with each item (`enabled: false`); missing `enabled` means on (legacy).

---

## Default starter channels

The public build ships only generic examples (Kurzgesagt in Longform, 3Blue1Brown in AI Skills; Games and News start empty). Add your own in Settings.

**Personal lists (not in git):** drop a `personal-feeds.local.json` into the extension folder shaped like
`{"longform":[{name,handle,channelId,url}], "ai-skills":[…], "games":[…], "news":[…]}`. It is used whenever starters are seeded (first install or **Reset starters**). All `*.local.json` files are gitignored.

## Sorting

A sort menu next to the status line offers **Recommended (Home order)** (Algorithm tab), **Newest to oldest**, **Oldest to newest**, **Most popular**, **Least popular**, **Longest to shortest**, **Shortest to longest**. The choice is saved per feed (one shared setting for playlist video lists) in `chrome.storage.local`. Card dates show a short local datetime (`M/D/YY h:mm AM/PM` in the browser timezone) from RSS `published` or Home scrape times; raw ISO strings are never shown. View counts and durations come from Home/RSS or the player/watch fetch; popularity sorts are disabled ("loading views…") until counts arrive, and duration sorts are disabled ("loading durations…") until lengths arrive. Items still missing a duration always sort last (including for shortest).

## Playlists tab

The **📂 Playlists** tab lists enabled playlists as **YouTube-like playlist cards** (thumbnail with stacked side panel / video count badge, title, “View full playlist”). Click opens playlist contents.

**Videos inside a playlist** use the **identical card layout** as channel feeds (thumb + duration badge + title + channel + meta). Opening a playlist shows a header with the playlist title, **Open on YouTube** (new tab), and **← All playlists**.

Where the list comes from (merged, stored in `chrome.storage.local`):
1. `playlists.local.json` in the extension folder (gitignored; array of `{name, url, playlistId}`) — read on first open and by **Refresh playlists**.
2. **Settings → Playlists → Sync from YouTube** — reads youtube.com/feed/playlists with your browser's existing YouTube login (best effort).
3. Add by URL/ID, or **Import JSON**.

Videos per playlist: public RSS `feeds/videos.xml?playlist_id=…` (newest ~15). If RSS 404s (private playlists, Liked, Watch later), the extension falls back to reading the playlist page with your YouTube login (first ~100 videos, durations included).

## Shorts blocker

When **Hide Shorts on YouTube** is ON (default):

- Hides Shorts shelves, guide/mini-guide Shorts entries, chips, reel shelves, and video tiles whose links are `/shorts/…` or show a Shorts badge
- On SPA navigations (`yt-navigate-finish`, history changes, DOM mutations), re-applies hiding
- Navigating to `/shorts/VIDEO_ID` redirects to `/watch?v=VIDEO_ID` when possible
- Prefers CSS + DOM hiding so normal long-form watch pages stay intact

---

## Limitations

- **Algorithm** requires you to be signed into YouTube in the **same Chrome profile** as the extension. It is a best-effort scrape of Home `ytInitialData`; YouTube markup changes can break parsing. It is not the official personalized API and may differ from what you see on youtube.com.
- Algorithm cache is short-lived; Refresh re-scrapes.
- Playlist RSS is capped at ~15 entries; private playlists need you signed in to YouTube in the same browser profile, and the page scrape can break if YouTube changes its markup.
- Playlist list is not auto-synced; use Sync/Refresh in Settings.
- **RSS returns ~15 latest videos per channel** (YouTube public feed). Merged feeds are sorted by publish date descending.
- Channel pages must be reachable to resolve new `@handles` (one-time); IDs are cached in storage.
- YouTube DOM changes can break some Shorts selectors; CSS + link-based hiding covers most cases; update the content script if a new shelf style appears.
- **Add to curated feed** depends on YouTube’s channel/watch DOM and embedded `ytInitialData`; header redesigns may move the button. Watch pages need a resolvable channel owner. Home, Search, Shorts, and playlist pages do not show the control.
- `chrome.storage.sync` quota is limited; many channels still fit. Falls back to `local` if sync fails.

---

## File layout

```
youtube-feeds-ext/
├── manifest.json
├── background.js          # service worker (feeds RSS, Algorithm scrape, resolve, open UI)
├── feeds.html / .css / .js
├── options.html / .css / .js
├── content/
│   ├── shorts-blocker.js / .css
│   └── add-to-feed.js / .css   # Add to curated feed on youtube.com
├── shared/
│   ├── defaults.js        # built-in feed defaults + starter channels
│   ├── storage.js
│   ├── resolve.js         # @handle / URL → channel ID
│   ├── rss.js
│   ├── algorithm.js       # Home recommendations scrape + cache
│   ├── playlists.js
│   └── duration.js        # InnerTube player + watch-page duration/views
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Privacy

- Permissions: `storage`, host access to `youtube.com` only.
- No analytics, no tracking, no external servers beyond YouTube itself.
- Algorithm and playlist sync use your existing YouTube session cookies in this browser profile; nothing is sent elsewhere.
