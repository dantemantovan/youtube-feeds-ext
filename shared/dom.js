/**
 * Tiny safe DOM builder: no HTML parsing. Strings become text nodes; attributes via setAttribute.
 * URL attributes (href/src) only accept http(s) or same-extension relative paths.
 */
const URL_ATTRS = new Set(["href", "src"]);

export function safeUrl(u) {
  const s = String(u ?? "").trim();
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//")) {
    try {
      const p = new URL(s.startsWith("//") ? "https:" + s : s);
      return p.protocol === "https:" || p.protocol === "http:" ? p.href : "";
    } catch (_) {
      return "";
    }
  }
  return s; // relative extension page, e.g. options.html#playlists
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (URL_ATTRS.has(k)) {
      const u = safeUrl(v);
      if (u) el.setAttribute(k, u);
    } else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === "") continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace all children of el with the given nodes/strings. */
export function setChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function svgPath(d, size = 18) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("fill", "currentColor");
  p.setAttribute("d", d);
  svg.appendChild(p);
  return svg;
}
