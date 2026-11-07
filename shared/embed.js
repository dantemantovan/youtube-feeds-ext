/**
 * Inline YouTube player support.
 *
 * Extension pages (moz-extension:// / chrome-extension://) send no HTTP Referer, and YouTube's embedded player
 * refuses to play without one (error 153). YouTube's Required Minimum Functionality terms say that clients in
 * such environments must identify themselves by setting Referer to https://<app id>. This registers one
 * session rule that sets that identifying Referer ONLY on www.youtube.com/embed/ sub-frame requests made by
 * this extension's own pages. No other requests are touched.
 */
const RULE_ID = 1730;

export function appReferer() {
  const id = chrome.runtime.id || "";
  // Firefox: stable add-on ID from the manifest ("name@domain" -> "name.domain").
  // Chromium: hyphenated app name + store/extension ID, as YouTube's terms describe for generated IDs.
  const host = id.includes("@") ? id.replace("@", ".") : `YouTube-Feeds-No-Shorts.${id}`;
  return `https://${host.toLowerCase()}/`;
}

export async function registerEmbedReferer() {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return false;
  const extHost = new URL(chrome.runtime.getURL("/")).host;
  await dnr.updateSessionRules({
    removeRuleIds: [RULE_ID],
    addRules: [
      {
        id: RULE_ID,
        priority: 1,
        condition: {
          urlFilter: "|https://www.youtube.com/embed/",
          resourceTypes: ["sub_frame"],
          initiatorDomains: [extHost],
        },
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "referer", operation: "set", value: appReferer() }],
        },
      },
    ],
  });
  return true;
}

const YT_EMBED_ORIGINS = { origins: ["https://www.youtube.com/*"] };

/**
 * Make sure the rule is installed (awaited) and report what the player needs, for the inline player's
 * readiness check and its "Player diagnostics" line.
 */
export async function prepareEmbed() {
  const out = {
    version: chrome.runtime.getManifest().version,
    hostAccess: false,
    rule: false,
    referer: appReferer(),
    matched: null,
    error: null,
  };
  try {
    out.hostAccess = await chrome.permissions.contains(YT_EMBED_ORIGINS);
  } catch (e) {
    out.error = String(e?.message || e);
  }
  try {
    await registerEmbedReferer();
    const rules = (await chrome.declarativeNetRequest.getSessionRules()) || [];
    out.rule = rules.some((r) => r.id === RULE_ID);
  } catch (e) {
    out.error = String(e?.message || e);
  }
  // testMatchOutcome exists for temporary/unpacked installs; use it when present as an extra check.
  try {
    if (chrome.declarativeNetRequest.testMatchOutcome) {
      const res = await chrome.declarativeNetRequest.testMatchOutcome({
        url: "https://www.youtube.com/embed/M7lc1UVf-VE",
        type: "sub_frame",
        initiator: new URL(chrome.runtime.getURL("/")).origin,
      });
      out.matched = (res?.matchedRules || []).some((r) => r.ruleId === RULE_ID);
    }
  } catch (_) {
    /* not available in this browser/install type */
  }
  out.ok = out.hostAccess && out.rule && out.matched !== false;
  return out;
}
