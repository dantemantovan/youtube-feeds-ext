/**
 * Default starter channels for each feed.
 * Users can edit/remove these in Settings.
 */

export const FEED_IDS = ["longform", "ai-skills", "games", "news"];

/** Legacy feed ids renamed in storage on load (old -> new). */
export const LEGACY_FEED_ID_MAP = { lore: "longform" };

export const FEED_META = {
  longform: {
    id: "longform",
    name: "Longform",
    description: "Long-form video essays, lore, history, science, and deep dives",
    icon: "📜",
  },
  "ai-skills": {
    id: "ai-skills",
    name: "AI Skills",
    description: "AI, tech, science, learning, and skills",
    icon: "🤖",
  },
  games: {
    id: "games",
    name: "Games",
    description: "League of Legends and similar gaming from channels you care about",
    icon: "🎮",
  },
  news: {
    id: "news",
    name: "News",
    description: "News, politics, and commentary",
    icon: "📰",
  },
};

/**
 * Starter channels (editable).
 * @returns {Record<string, Array<{name: string, handle: string, channelId: string, url: string}>>}
 */
export function getStarterChannels() {
  // Generic public examples. Personal lists load from personal-feeds.local.json (gitignored) if present.
  const ch = (name, handle, channelId) => ({ name, handle, channelId, url: `https://www.youtube.com/${handle}` });
  return {
    longform: [ch("Kurzgesagt – In a Nutshell", "@kurzgesagt", "UCsXVk37bltHxD1rDPwtNM8Q")],
    "ai-skills": [ch("3Blue1Brown", "@3blue1brown", "UCYO_jab_esuFRV4b17AJtAw")],
    games: [],
    news: [],
  };
}

/** Bump when starter channel lists change so existing installs reseed once. */
export const STARTERS_VERSION = 2;

export const DEFAULT_SETTINGS = {
  hideShorts: true,
  feedsInitialized: false,
  startersVersion: 0,
};
