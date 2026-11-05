# YouTube Feeds + No Shorts

Manifest V3 Chrome / Edge extension that:

1. **Hides YouTube Shorts** everywhere on `youtube.com` (shelves, tab/chip, tiles, related; redirects `/shorts/VIDEO_ID` → `/watch?v=VIDEO_ID`)
2. Provides **four curated long-form feeds**: **Longform**, **AI Skills**, **Games**, and **News**
3. Adds an **Algorithm** tab that scrapes your signed-in YouTube Home into the same video cards (no API key, stays inside the extension)
4. Shows **Playlists** with YouTube-like playlist cards and the same video cards as other feeds

No Google API key. Curated feeds use YouTube’s public channel RSS. Algorithm uses a Home page scrape with your browser cookies. No analytics, no remote code.

---

## Load unpacked (Chrome or Edge on Windows)

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

- Toolbar action → opens **Feeds** (`feeds.html`) with tabs: Longform · AI Skills · Games · News · **Algorithm** · Playlists.
- Focusing the toolbar icon focuses an existing Feeds tab when one is already open (does not navigate your current tab away).
- Upgrading from an older version: a stored `lore` feed is automatically migrated to `longform` on load (your channels are kept), and a missing `news` feed is filled from starters.
- Each video card shows thumbnail, duration badge, title, channel, views/time; click opens YouTube in a **new tab**.
- Shorts RSS entries (`/shorts/…`) are filtered out.
- **Hide Shorts** toggle (default ON) is on the Feeds header and in Settings.
- **Settings** (gear) opens in a new tab → add channels per feed, enable/disable channels and playlists, or **Reset starters**.

### Algorithm tab (v1.4.0)

**Algorithm** approximates YouTube Home recommendations **inside the Feeds UI**:

1. The extension fetches `https://www.youtube.com/` with cookies from this Chrome profile.
2. It parses Home rich-grid / lockup video renderers (`videoId`, title, channel, thumb, length, view count when present).
3. Results render as the **same cards** as other feeds. It does **not** navigate to or embed YouTube Home.
4. Last scrape is cached briefly in `chrome.storage.local` (~5 minutes). **↻ Refresh** forces a new scrape.
5. Default sort for this tab is **Recommended (Home order)**; newest/oldest/popular still work when metadata allows.

If you are signed out of YouTube in this profile (or Home cannot be parsed), the tab shows an empty state with a Sync/Refresh button.

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

A sort menu next to the status line offers **Recommended (Home order)** (Algorithm tab), **Newest to oldest**, **Oldest to newest**, **Most popular**, **Least popular**, **Longest to shortest**, **Shortest to longest**. The choice is saved per feed (one shared setting for playlist video lists) in `chrome.storage.local`. Dates come from RSS `published` or Home relative times. View counts and durations come from Home/RSS or the player/watch fetch; popularity sorts are disabled ("loading views…") until counts arrive, and duration sorts are disabled ("loading durations…") until lengths arrive. Items still missing a duration always sort last (including for shortest).

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
│   ├── shorts-blocker.js
│   └── shorts-blocker.css
├── shared/
│   ├── defaults.js        # feed names + starter channels
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
