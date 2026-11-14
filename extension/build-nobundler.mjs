// Fallback build without a bundler (for sandboxes where vite build cannot run).
// Copies src + public to dist, vendors the firebase ESM bundles that `vite` pre-bundled
// into node_modules/.vite/deps (run `npm run dev` once first), rewrites bare imports and
// writes the Firebase web config from web/.env.local into dist/config.js (never committed).
import fs from "node:fs";
import path from "node:path";
const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, "public"), dist, { recursive: true });
fs.cpSync(path.join(root, "src"), dist, { recursive: true });
fs.cpSync(path.join(root, "../node_modules/.vite/deps"), path.join(dist, "vendor"), { recursive: true, filter: (f) => !f.endsWith(".map") });
const env = Object.fromEntries(fs.readFileSync(path.join(root, "../web/.env.local"), "utf8").split("\n").filter((l) => /^VITE_\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
fs.writeFileSync(path.join(dist, "config.js"), `export const env = ${JSON.stringify(env)};\n`, { mode: 0o600 });
const ai = path.join(dist, "ai.js");
let s = fs.readFileSync(ai, "utf8")
  .replace('from "firebase/app-check"', 'from "./vendor/firebase_app-check.js"')
  .replace('from "firebase/app"', 'from "./vendor/firebase_app.js"')
  .replace('from "firebase/ai"', 'from "./vendor/firebase_ai.js"')
;
fs.writeFileSync(ai, s);
const platform = path.join(dist, "platform.js");
fs.writeFileSync(platform, fs.readFileSync(platform, "utf8").replace("const env = import.meta.env;", 'import { env } from "./config.js";'));
// content.js must be a classic script: inline detect.js without its exports.
const detect = fs.readFileSync(path.join(root, "src/lib/detect.js"), "utf8").replace(/^export /gm, "");
const content = fs.readFileSync(path.join(root, "src/content.js"), "utf8").replace(/^import .*$/m, "");
fs.writeFileSync(path.join(dist, "content.js"), `(() => {\n${detect}\n${content}\n})();\n`);
console.log("built", dist);
