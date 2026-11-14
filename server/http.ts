import { createServer } from "node:http";
import { BlockList } from "node:net";
import { networkInterfaces } from "node:os";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

type Api = (url: URL, method: string) => Promise<Response>;
const mime: Record<string, string> = { js: "text/javascript", css: "text/css", svg: "image/svg+xml", html: "text/html; charset=utf-8", woff2: "font/woff2", png: "image/png", ico: "image/x-icon" };
export function localNetworkPolicy(port: number, lan: boolean) {
  const peers = new BlockList(); peers.addSubnet("127.0.0.0", 8);
  const privateRanges = new BlockList();
  privateRanges.addSubnet("10.0.0.0", 8); privateRanges.addSubnet("172.16.0.0", 12); privateRanges.addSubnet("192.168.0.0", 16);
  const addresses = Object.values(networkInterfaces()).flat().filter(address => address?.family === "IPv4" &&
    !address.internal && address.cidr && privateRanges.check(address.address));
  const hosts = new Set(["localhost:" + port, "127.0.0.1:" + port]);
  if (lan) for (const address of addresses) {
    if (!address?.cidr) continue;
    hosts.add(address.address + ":" + port);
    peers.addSubnet(address.address, Number(address.cidr.split("/")[1]));
  }
  return { hosts, peers, addresses: lan ? addresses.map(address => address!.address) : [] };
}

export function httpApplication(api: Api, options: { port: number; lan: boolean; dist: string }) {
  const policy = localNetworkPolicy(options.port, options.lan);
  const server = createServer(async (request, response) => {
    const access = options.port === 0 ? localNetworkPolicy(request.socket.localPort!, options.lan) : policy;
    const host = request.headers.host;
    const address = request.socket.remoteAddress?.replace(/^::ffff:/, "");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    if (!host || !access.hosts.has(host) || !address || !access.peers.check(address)) { response.writeHead(403).end(); return; }
    try {
      const url = new URL(request.url ?? "/", "http://" + host);
      if (url.origin !== "http://" + host) { response.writeHead(403).end(); return; }
      const method = request.method ?? "GET";
      if (url.pathname.startsWith("/api/")) {
        const allowed: Record<string, string[]> = { "/api/market": ["GET"], "/api/watchlist": ["GET", "PUT", "DELETE"], "/api/giants": ["GET", "PUT", "POST"] };
        if (!allowed[url.pathname]) { response.writeHead(404).end(); return; }
        if (!allowed[url.pathname].includes(method)) { response.writeHead(405, { Allow: allowed[url.pathname].join(", ") }).end(); return; }
        const origin = request.headers.origin;
        if (request.headers["sec-fetch-site"] === "cross-site" || (origin && origin !== url.origin)) { response.writeHead(403).end(); return; }
        if (Number(request.headers["content-length"] || 0) > 1024) { response.writeHead(413).end(); return; }
        request.resume();
        const result = await api(url, method);
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      if (!["GET", "HEAD"].includes(method)) { response.writeHead(405).end(); return; }
      const path = url.pathname === "/" || url.pathname === "/index.html" ? "index.html"
        : url.pathname === "/favicon.svg" ? "favicon.svg"
        : /^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname) ? url.pathname.slice(1) : null;
      // No filesystem fallback: .env, SQLite, source files, and backups are never served.
      if (!path) { response.writeHead(404).end(); return; }
      const file = resolve(options.dist, path);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "Content-Type": mime[path.split(".").at(-1)!] || "application/octet-stream",
        "Cache-Control": path.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-store" });
      response.end(method === "HEAD" ? undefined : await readFile(file));
    } catch { if (!response.headersSent) response.writeHead(500); response.end("서버에서 자료를 처리하지 못했습니다."); }
  });
  server.requestTimeout = 120_000;
  return { server, addresses: policy.addresses };
}
