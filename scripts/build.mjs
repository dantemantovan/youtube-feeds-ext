#!/usr/bin/env node
// Reproducible build: emits dist/chromium and dist/firefox (unpacked + zip) from the same sources.
// manifest.json in the repo is the Chromium manifest; the Firefox manifest is derived here.
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
const FILES = ["background.js", "feeds.html", "feeds.js", "feeds.css", "options.html", "options.js", "options.css", "README.md", "content", "icons", "shared"];
const base = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

const firefox = structuredClone(base);
firefox.background = { scripts: ["background.js"], type: "module" };
firefox.browser_specific_settings = {
  gecko: {
    id: "youtube-feeds-ext@dantemantovan",
    // 140 = first desktop release that understands data_collection_permissions.
    strict_min_version: "140.0",
    // No data is sent to the developer or any third party; requests go only to youtube.com for the user's own feeds.
    data_collection_permissions: { required: ["none"] },
  },
  // Only states the minimum Firefox for Android that understands the keys above (142). Android is untested;
  // choose desktop-only platforms when uploading to AMO unless it has been tested.
  gecko_android: { strict_min_version: "142.0" },
};

const targets = { chromium: base, firefox };
rmSync(out, { recursive: true, force: true });
for (const [name, manifest] of Object.entries(targets)) {
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) cpSync(join(root, f), join(dir, f), { recursive: true, filter: (s) => !/\.local\.json$|\.DS_Store$/.test(s) });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const zip = join(out, `youtube-feeds-ext-${base.version}-${name}.zip`);
  // python zipfile is available everywhere we build; entries sorted for reproducibility
  execFileSync("python3", ["-c", `
import zipfile,os,sys
d,z=sys.argv[1],sys.argv[2]
fs=sorted(os.path.relpath(os.path.join(r,f),d) for r,_,n in os.walk(d) for f in n)
with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED) as zf:
  for f in fs:
    i=zipfile.ZipInfo(f.replace(os.sep,'/'),(2020,1,1,0,0,0)); i.compress_type=zipfile.ZIP_DEFLATED; i.external_attr=0o644<<16
    zf.writestr(i,open(os.path.join(d,f),'rb').read())
`, dir, zip]);
  console.log("built", zip);
}
