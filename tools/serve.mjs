/**
 * Tiny static server for previewing dist/ locally, with GitHub Pages-like behaviour:
 * /foo -> 301 /foo/, /foo/ -> foo/index.html, unknown paths -> 404.html.
 *
 *   npm run preview            (PORT=3000 npm run preview to change the port)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".gif": "image/gif", ".ico": "image/x-icon", ".avif": "image/avif", ".json": "application/json" };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!urlPath.endsWith("/")) { res.writeHead(301, { Location: urlPath + "/" }).end(); return; }
    file = path.join(file, "index.html");
  }
  const found = fs.existsSync(file);
  const target = found ? file : path.join(DIST, "404.html");
  res.writeHead(found ? 200 : 404, { "Content-Type": TYPES[path.extname(target).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(target).pipe(res);
}).listen(PORT, () => console.log(`Previewing dist/ at http://localhost:${PORT}`));
