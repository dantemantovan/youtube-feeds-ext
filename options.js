import { FEED_IDS, FEED_META } from "./shared/defaults.js";

const feedTabs = document.getElementById("feedTabs");
const channelList = document.getElementById("channelList");
const addForm = document.getElementById("addForm");
const channelInput = document.getElementById("channelInput");
const nameInput = document.getElementById("nameInput");
const formMsg = document.getElementById("formMsg");
const shortsToggle = document.getElementById("shortsToggle");
const resetBtn = document.getElementById("resetBtn");
const addBtn = document.getElementById("addBtn");

const state = {
  feedId: ((v) => (v === "lore" ? "longform" : v))(localStorage.getItem("yfn.settingsFeed")) || "longform",
};

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, error: "No response" });
    });
  });
}

function setMsg(text, kind = "") {
  formMsg.textContent = text || "";
  formMsg.className = "msg" + (kind ? " " + kind : "");
}

function renderTabs() {
  feedTabs.innerHTML = "";
  for (const id of FEED_IDS) {
    const meta = FEED_META[id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "feed-tab" + (id === state.feedId ? " active" : "");
    btn.textContent = `${meta.icon} ${meta.name}`;
    btn.addEventListener("click", () => {
      state.feedId = id;
      localStorage.setItem("yfn.settingsFeed", id);
      renderTabs();
      loadChannels();
    });
    feedTabs.appendChild(btn);
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadChannels() {
  const res = await send({ type: "GET_FEED_CHANNELS", feedId: state.feedId });
  const channels = res.channels || [];
  channelList.innerHTML = "";
  if (!channels.length) {
    channelList.innerHTML = `<li class="channel-item"><div class="meta"><span class="name">No channels yet</span><span class="id">Add one above — or Reset starters</span></div></li>`;
    return;
  }
  channels.forEach((ch, index) => {
    const li = document.createElement("li");
    li.className = "channel-item";
    li.innerHTML = `
      <div class="meta">
        <span class="name">${escapeHtml(ch.name || ch.handle || "Channel")}</span>
        <span class="id">${escapeHtml(ch.handle || ch.url || "")}${ch.channelId ? " · " + escapeHtml(ch.channelId) : ""}</span>
      </div>
      <button type="button" class="btn btn-danger" data-index="${index}">Remove</button>`;
    li.querySelector("button").addEventListener("click", async () => {
      await send({ type: "REMOVE_CHANNEL", feedId: state.feedId, index });
      loadChannels();
    });
    channelList.appendChild(li);
  });
}

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = channelInput.value.trim();
  if (!input) return;
  setMsg("Resolving channel…");
  addBtn.disabled = true;
  const res = await send({
    type: "ADD_CHANNEL",
    feedId: state.feedId,
    input,
    name: nameInput.value.trim(),
  });
  addBtn.disabled = false;
  if (!res.ok) {
    setMsg(res.error || "Could not add channel", "error");
    return;
  }
  channelInput.value = "";
  nameInput.value = "";
  setMsg(`Added ${res.channel?.name || "channel"}`, "ok");
  loadChannels();
});

async function initShortsToggle() {
  const res = await send({ type: "GET_SETTINGS" });
  const on = res.settings?.hideShorts !== false;
  shortsToggle.classList.toggle("on", on);
  shortsToggle.setAttribute("aria-pressed", on ? "true" : "false");
  shortsToggle.addEventListener("click", async () => {
    const next = !shortsToggle.classList.contains("on");
    shortsToggle.classList.toggle("on", next);
    shortsToggle.setAttribute("aria-pressed", next ? "true" : "false");
    await send({ type: "SAVE_SETTINGS", settings: { hideShorts: next } });
  });
}

resetBtn.addEventListener("click", async () => {
  if (!confirm("Reset all three feeds to the built-in starter channels? Your custom channels will be removed.")) {
    return;
  }
  const res = await send({ type: "RESET_STARTERS" });
  if (!res.ok) {
    setMsg(res.error || "Reset failed", "error");
    return;
  }
  setMsg("Restored starter channels", "ok");
  loadChannels();
});

renderTabs();
initShortsToggle();
loadChannels();

// ---- Playlists ----
const plList = document.getElementById("plList");
const plMsg = document.getElementById("plMsg");
function setPlMsg(t, kind = "") { plMsg.textContent = t; plMsg.className = "msg" + (kind ? " " + kind : ""); }
function renderPlaylists(list) {
  plList.innerHTML = "";
  if (!list?.length) {
    plList.innerHTML = `<li class="channel-item"><div class="meta"><span class="name">No playlists yet</span><span class="id">Sync, add, or import above</span></div></li>`;
    return;
  }
  for (const p of list) {
    const li = document.createElement("li");
    li.className = "channel-item";
    li.innerHTML = `<div class="meta"><span class="name">${escapeHtml(p.name)}</span><span class="id">${escapeHtml(p.playlistId)}</span></div>
      <button type="button" class="btn btn-danger">Remove</button>`;
    li.querySelector("button").addEventListener("click", async () => {
      renderPlaylists((await send({ type: "REMOVE_PLAYLIST", playlistId: p.playlistId })).playlists);
    });
    plList.appendChild(li);
  }
}
async function plAction(msg, label) {
  setPlMsg(label + "…");
  const res = await send(msg);
  if (!res.ok) return setPlMsg(res.error || "Failed", "error");
  renderPlaylists(res.playlists);
  const errs = res.errors?.length ? ` (${res.errors.join("; ")})` : "";
  setPlMsg(`${res.playlists.length} playlists stored${errs}`, errs ? "error" : "ok");
}
document.getElementById("plSyncBtn").addEventListener("click", () => plAction({ type: "REFRESH_PLAYLISTS", scrape: true }, "Syncing from YouTube"));
document.getElementById("plRefreshBtn").addEventListener("click", () => plAction({ type: "REFRESH_PLAYLISTS" }, "Refreshing"));
document.getElementById("plImport").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    await plAction({ type: "IMPORT_PLAYLISTS", playlists: Array.isArray(data) ? data : data.playlists || [] }, "Importing");
  } catch (err) { setPlMsg("Invalid JSON: " + err.message, "error"); }
  e.target.value = "";
});
document.getElementById("plAddForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("plInput"), name = document.getElementById("plName");
  await plAction({ type: "ADD_PLAYLIST", input: input.value, name: name.value.trim() }, "Adding");
  input.value = ""; name.value = "";
});
send({ type: "GET_PLAYLISTS" }).then((r) => renderPlaylists(r.playlists));
