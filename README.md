# YouTube Feeds + No Shorts

Manifest V3 Chrome / Edge extension that:

1. **Hides YouTube Shorts** everywhere on `youtube.com` (shelves, tab/chip, tiles, related; redirects `/shorts/VIDEO_ID` → `/watch?v=VIDEO_ID`)
2. Provides **four curated long-form feeds**: **Longform**, **AI Skills**, **Games**, and **News**

No Google API key. Feeds use YouTube’s public channel RSS. No analytics, no remote code.

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

- Toolbar action → opens **Feeds** (`feeds.html`) with four tabs: Longform · AI Skills · Games · News.
- Upgrading from an older version: a stored `lore` feed is automatically migrated to `longform` on load (your channels are kept), and a missing `news` feed is filled from starters.
- Each card shows thumbnail, title, channel, relative publish time; click opens YouTube.
- Shorts RSS entries (`/shorts/…`) are filtered out.
- **Hide Shorts** toggle (default ON) is on the Feeds header and in Settings.
- **Settings** (gear) → add/remove channels per feed, or **Reset starters**.

### Adding a channel

In Settings, pick a feed tab, then enter any of:

- `@handle` (e.g. `@Caedrel`)
- Channel URL (`https://www.youtube.com/@Caedrel` or `/channel/UC…`)
- Channel ID (`UC…`)

Optional display name. The extension fetches the channel page once, caches the `UC…` id, then pulls RSS.

---

## Default starter channels

The public build ships only generic examples (Kurzgesagt in Longform, 3Blue1Brown in AI Skills; Games and News start empty). Add your own in Settings.

**Personal lists (not in git):** drop a `personal-feeds.local.json` into the extension folder shaped like
`{"longform":[{name,handle,channelId,url}], "ai-skills":[…], "games":[…], "news":[…]}`. It is used whenever starters are seeded (first install or **Reset starters**). It is gitignored.

## Sorting

A sort menu next to the status line offers **Newest to oldest**, **Oldest to newest**, **Most popular**, **Least popular**. The choice is saved per feed (one shared setting for playlist video lists) in `chrome.storage.local`. Dates come from RSS `published`. View counts come from RSS `media:statistics` or, when missing, the watch-page fetch that also supplies durations; popularity sorts are disabled ("loading views…") until counts arrive, and videos without counts keep RSS order at the end. Playlist videos from the signed-in page fallback have no publish date, so date sorts keep playlist order.

## Playlists tab (v1.3.0)

The **📂 Playlists** tab lists your YouTube playlists as cards; click one to browse its videos (thumbnail, title, channel, duration badge, published date when available). **← All playlists** goes back.

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

- Playlist RSS is capped at ~15 entries; private playlists need you signed in to YouTube in the same browser profile, and the page scrape can break if YouTube changes its markup.
- Playlist list is not auto-synced; use Sync/Refresh in Settings.


- **RSS returns ~15 latest videos per channel** (YouTube public feed). Merged feeds are sorted by publish date descending.
- No personalized recommendations — only channels you configure.
- Channel pages must be reachable to resolve new `@handles` (one-time); IDs are cached in storage.
- YouTube DOM changes can break some Shorts selectors; CSS + link-based hiding covers most cases; update the content script if a new shelf style appears.
- `chrome.storage.sync` quota is limited; many channels still fit. Falls back to `local` if sync fails.
- Does not require or use your Google login.

---

## File layout

```
youtube-feeds-ext/
├── manifest.json
├── background.js          # service worker (feeds RSS, resolve, open UI)
├── feeds.html / .css / .js
├── options.html / .css / .js
├── content/
│   ├── shorts-blocker.js
│   └── shorts-blocker.css
├── shared/
│   ├── defaults.js        # feed names + starter channels
│   ├── storage.js
│   ├── resolve.js         # @handle / URL → channel ID
│   └── rss.js
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
