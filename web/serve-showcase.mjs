import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("./showcase-dist/", import.meta.url));
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }

  const path = (req.url ?? "/").split("?")[0];
  const asset = /^\/assets\/[\w.-]+$/.test(path);
  if (path !== "/" && path !== "/favicon.svg" && !asset) {
    res.writeHead(404).end("Not found");
    return;
  }

  const file = join(dist, path === "/" ? "index.html" : path.slice(1));
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    res.writeHead(404).end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": asset ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).on("error", () => res.destroy()).pipe(res);
});

await stat(join(dist, "index.html")).catch(() => {
  throw new Error("Run npm run build:showcase before serving the Nightshift homepage.");
});
server.listen(Number(process.env.PORT ?? 4100), "0.0.0.0", () => {
  console.log(`Nightshift showcase listening on port ${server.address().port}`);
});
