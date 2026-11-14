// Builds the hosted site (Firebase Hosting public dir `site/`) without a bundler:
//   site/index.html      <- tools/build-demo.mjs (sample tables + playground shell)
//   site/app/*.js        <- the SAME modules the extension uses (extension/src), copied
//   site/app/vendor/     <- Firebase ESM bundles pre-bundled by vite (run `npm run dev` once)
//   site/app/config.js   <- Firebase web config + reCAPTCHA Enterprise site key from web/.env.local
// site/app is generated and gitignored. The App Check debug token is never written to the site.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "extension/src"), app = path.join(root, "site/app");
execFileSync(process.execPath, [path.join(root, "tools/build-demo.mjs")], { stdio: "inherit" });
fs.rmSync(app, { recursive: true, force: true });
fs.mkdirSync(path.join(app, "lib"), { recursive: true });
for (const f of ["app.js", "ui.css", "lib/infer.js", "lib/pii.js", "lib/tidy.js", "lib/hybrid.js", "lib/parse.js", "lib/export.js", "lib/zip.js"]) fs.copyFileSync(path.join(src, f), path.join(app, f));
fs.copyFileSync(path.join(root, "web/src/playground.js"), path.join(app, "playground.js"));
fs.cpSync(path.join(root, "node_modules/.vite/deps"), path.join(app, "vendor"), { recursive: true, filter: (f) => !f.endsWith(".map") && !f.endsWith("_metadata.json") && !f.endsWith("package.json") });
fs.writeFileSync(path.join(app, "ai.js"), fs.readFileSync(path.join(src, "ai.js"), "utf8")
  .replace('from "firebase/app-check"', 'from "./vendor/firebase_app-check.js"')
  .replace('from "firebase/app"', 'from "./vendor/firebase_app.js"')
  .replace('from "firebase/ai"', 'from "./vendor/firebase_ai.js"'));
const env = Object.fromEntries(fs.readFileSync(path.join(root, "web/.env.local"), "utf8").split("\n").filter((l) => /^VITE_\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const firebaseConfig = { apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID };
if (!env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) throw new Error("VITE_RECAPTCHA_ENTERPRISE_SITE_KEY missing in web/.env.local");
fs.writeFileSync(path.join(app, "config.js"), `// Generated. Firebase web config is public by design; access is protected by App Check and API key restrictions.\nexport const firebaseConfig = ${JSON.stringify(firebaseConfig)};\nexport const recaptchaSiteKey = ${JSON.stringify(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY)};\n`);
// Guard: the public site must never contain the App Check debug token.
const debug = env.VITE_APPCHECK_DEBUG_TOKEN;
let files = 0;
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else { files++; const s = fs.readFileSync(p, "utf8"); if (debug && s.includes(debug)) throw new Error(`debug token found in ${p}`); if (/FIREBASE_APPCHECK_DEBUG_TOKEN\s*=\s*["'`]/.test(s)) throw new Error(`hard-coded debug token assignment in ${p}`); } } };
walk(path.join(root, "site"));
console.log(`built site/app (${files} files in site/, debug token check passed)`);
// Guard: every relative import in site/app must resolve to a file that is deployed.
for (const f of fs.readdirSync(app, { recursive: true }).filter((f) => f.endsWith(".js") && !f.startsWith("vendor"))) {
  const s = fs.readFileSync(path.join(app, f), "utf8");
  for (const m of s.matchAll(/^import\s[^"']*["'](\.[^"']+)["']/gm)) {
    const target = path.join(app, path.dirname(f), m[1]);
    if (!fs.existsSync(target)) throw new Error(`${f} imports ${m[1]} which is not in site/app`);
  }
}
console.log("import check passed");
