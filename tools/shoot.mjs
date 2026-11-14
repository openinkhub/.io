/**
 * Take website screenshots with the local headless Chrome (no npm dependencies; uses the DevTools protocol).
 *
 *   node tools/shoot.mjs <url> <out.webp> [width=1280] [height=800]
 *
 * Saves a WebP (quality 72) of the first screen, after the page and its images have loaded.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [url, out, W = "1280", H = "800"] = process.argv.slice(2);
if (!url || !out) { console.error("usage: node tools/shoot.mjs <url> <out.webp> [width] [height]"); process.exit(1); }
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
if (!CHROME) { console.error("Chrome not found"); process.exit(1); }
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "shoot-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars",
  "--no-first-run", "--no-default-browser-check", `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
}
if (!target) { chrome.kill(); throw new Error("Chrome did not start"); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const events = [];
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d.method); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
for (let i = 0; i < 100 && !events.includes("Page.loadEventFired"); i++) await sleep(200);
// let lazy images, fonts and hero animations settle; close common cookie/popup overlays if present
await sleep(4000);
await send("Runtime.evaluate", { expression: `document.querySelectorAll('[class*=cookie] button,[id*=cookie] button').forEach(b=>{if(/accept|agree|ok|got it/i.test(b.textContent))b.click()})` });
await sleep(800);
const shot = await send("Page.captureScreenshot", { format: "webp", quality: 72, clip: { x: 0, y: 0, width: +W, height: +H, scale: 1 } });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
console.log(`${out}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
