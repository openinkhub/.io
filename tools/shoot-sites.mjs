/**
 * Hero screenshots for the "Our Success Stories" site cards (content/success-stories.json sites).
 *
 *   node tools/shoot-sites.mjs            (only sites without a screenshot yet)
 *   node tools/shoot-sites.mjs --all      (re-take every screenshot)
 *
 * One headless Chrome, 6 tabs at a time. Each site's first screen is captured at 1280x800 and saved at
 * 640x400 as WebP in static/images/success/<host>.webp. Sites that fail to load, or show an error or blank page,
 * get no image (the card then shows a plain placeholder); see the summary printed at the end.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "content", "success-stories.json");
const OUT = path.join(ROOT, "static", "images", "success");
const ALL = process.argv.includes("--all");
const W = 1280, H = 800, PAR = 6;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
if (!CHROME) { console.error("Chrome not found"); process.exit(1); }
export const shotFile = (url) => new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "-") + ".webp";

const D = JSON.parse(fs.readFileSync(DATA, "utf8"));
fs.mkdirSync(OUT, { recursive: true });
const todo = D.sites.filter((s) => ALL || !fs.existsSync(path.join(OUT, shotFile(s.url))));
console.log(`${todo.length} of ${D.sites.length} sites to capture`);

const port = 9600 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "shoot-sites-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars",
  "--no-first-run", "--no-default-browser-check", "--mute-audio", `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 50 && !up; i++) { await sleep(200); try { await fetch(`http://127.0.0.1:${port}/json/version`); up = true; } catch {} }
if (!up) { chrome.kill(); throw new Error("Chrome did not start"); }

async function capture(site) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const events = new Set();
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.add(d.method); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  try {
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    const nav = await send("Page.navigate", { url: site.url });
    if (nav.result?.errorText) return { ok: false, why: nav.result.errorText };
    for (let i = 0; i < 100 && !events.has("Page.loadEventFired"); i++) await sleep(200);
    await sleep(4000);
    await send("Runtime.evaluate", { expression: `document.querySelectorAll('[class*=cookie] button,[id*=cookie] button').forEach(b=>{if(/accept|agree|ok|got it/i.test(b.textContent))b.click()})` });
    await sleep(800);
    const read = async () => (await send("Runtime.evaluate", { returnByValue: true, expression: `({ title: document.title, url: location.href, text: (document.body?.innerText || "").trim().slice(0, 3000) })` })).result?.result?.value || {};
    let info = await read();
    // a host's "checking your browser" wait screen clears by itself, as for any visitor: wait for it (up to ~20 s)
    for (let i = 0; i < 10 && /checking your browser|just a moment|please wait/i.test(info.text || ""); i++) { await sleep(2000); info = await read(); }
    // pages still rendering (little more than the menu): give them more time, then let images settle
    if ((info.text || "").length < 300) { await sleep(8000); info = await read(); }
    await sleep(1500);
    // error / parked / empty / default-install pages are not shown as a "success story"
    const bad = /(404|not found|502|503|bad gateway|service unavailable|domain .*(for sale|parked|expired)|this site can.t be reached|account suspended|coming soon|under construction|index of \/)/i;
    if (!info.text || info.text.length < 40) return { ok: false, why: "blank page", info };
    if (/checking your browser|just a moment/i.test(info.text)) return { ok: false, why: "browser check screen", info };
    if (bad.test(info.title || "") || bad.test(info.text.slice(0, 200))) return { ok: false, why: "error or parked page", info };
    if (/Hello world!|Welcome to WordPress\. This is your first post/i.test(info.text)) return { ok: false, why: "default WordPress page (no content yet)", info };
    const shot = await send("Page.captureScreenshot", { format: "webp", quality: 70, clip: { x: 0, y: 0, width: W, height: H, scale: 0.5 } });
    if (!shot.result) return { ok: false, why: "capture failed" };
    fs.writeFileSync(path.join(OUT, shotFile(site.url)), Buffer.from(shot.result.data, "base64"));
    return { ok: true, info };
  } catch (e) { return { ok: false, why: e.message }; }
  finally { ws.close(); try { await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`); } catch {} }
}

const results = [];
for (let i = 0; i < todo.length; i += PAR) {
  const batch = todo.slice(i, i + PAR);
  const res = await Promise.all(batch.map((s) => Promise.race([capture(s), sleep(45000).then(() => ({ ok: false, why: "timeout" }))])));
  batch.forEach((s, k) => {
    results.push({ url: s.url, ...res[k] });
    // a site that no longer qualifies loses its old screenshot (its card falls back to the placeholder)
    if (!res[k].ok) fs.rmSync(path.join(OUT, shotFile(s.url)), { force: true });
    console.log(`${res[k].ok ? "ok  " : "SKIP"} ${s.url}${res[k].ok ? "" : "  (" + res[k].why + ")"}`);
  });
}
chrome.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
const failed = results.filter((r) => !r.ok);
// report: merged with earlier runs, one row per site
const REPORT = path.join(ROOT, "content", "seo", "success-shots.json");
const prev = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, "utf8")).results : [];
const rows = new Map(prev.map((r) => [r.url, r]));
const stamp = new Date().toISOString();
for (const { url, ok, why, info } of results) rows.set(url, { url, ok, why, title: info?.title, checked: stamp });
fs.writeFileSync(REPORT, JSON.stringify({ updated: stamp, results: D.sites.map((s) => rows.get(s.url) || { url: s.url, ok: fs.existsSync(path.join(OUT, shotFile(s.url))) }) }, null, 1));
console.log(`done: ${results.length - failed.length} captured, ${failed.length} skipped`);
process.exit(0);
