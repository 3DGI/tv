import { createServer } from "node:http";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { networkInterfaces } from "node:os";
import { extname, normalize, resolve, sep } from "node:path";
import packageJson from "./package.json" with { type: "json" };

type CliOptions = {
  host: string;
  port: number;
  viewerPort: number;
  tileset: string;
  viewerUrl?: string;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const DEFAULT_VIEWER_PORT = 3000;
const DEFAULT_TILESET = "tileset.json";
const PLACEHOLDER_GITHUB_USERNAME = "YOUR_GITHUB_USERNAME";
const VIEWER_DIST_DIR = resolve(import.meta.dir, "dist");

const MIME_TYPES: Record<string, string> = {
  ".b3dm": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".cmpt": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".i3dm": "application/octet-stream",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".ktx2": "image/ktx2",
  ".pnts": "application/octet-stream",
  ".png": "image/png",
  ".subtree": "application/json",
  ".svg": "image/svg+xml",
  ".terrain": "application/octet-stream",
  ".wasm": "application/wasm",
};

function printHelp() {
  console.log(`3dtiles-tester

Usage:
  nix run <repo> -- [options]

Options:
  --host <host>             Bind host (default: ${DEFAULT_HOST})
  --port <port>             Tileset server port (default: ${DEFAULT_PORT})
  --viewer-port <port>      Viewer server port (default: ${DEFAULT_VIEWER_PORT})
  --tileset <path>          Tileset path relative to cwd (default: ${DEFAULT_TILESET})
  --viewer-url <url>        Override the deployed viewer URL
  -h, --help                Show help
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    viewerPort: DEFAULT_VIEWER_PORT,
    tileset: DEFAULT_TILESET,
    viewerUrl: process.env.VIEWER_URL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }

    const value = argv[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${arg}`);
    }

    switch (arg) {
      case "--host":
        options.host = value;
        index += 1;
        break;
      case "--port":
        options.port = Number.parseInt(value, 10);
        index += 1;
        break;
      case "--viewer-port":
        options.viewerPort = Number.parseInt(value, 10);
        index += 1;
        break;
      case "--tileset":
        options.tileset = value;
        index += 1;
        break;
      case "--viewer-url":
        options.viewerUrl = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isInteger(options.viewerPort) || options.viewerPort <= 0) {
    throw new Error(`Invalid viewer port: ${options.viewerPort}`);
  }

  return options;
}

function getViewerBaseUrl(explicitViewerUrl?: string): string | undefined {
  const candidate = explicitViewerUrl ?? packageJson.homepage;
  if (!candidate || candidate.includes(PLACEHOLDER_GITHUB_USERNAME)) {
    return undefined;
  }

  return candidate.endsWith("/") ? candidate : `${candidate}/`;
}

function buildViewerUrl(baseUrl: string, tilesetUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("tileset", tilesetUrl);
  return url.toString();
}

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return undefined;
  }

  return (
    parts[0] * 256 ** 3 +
    parts[1] * 256 ** 2 +
    parts[2] * 256 +
    parts[3]
  );
}

function isTailscaleIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === undefined) {
    return false;
  }

  const start = ipv4ToInt("100.64.0.0")!;
  const end = ipv4ToInt("100.127.255.255")!;
  return value >= start && value <= end;
}

function getTailscaleIpv4(): string | undefined {
  const interfaces = networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      if (isTailscaleIpv4(entry.address)) {
        return entry.address;
      }
    }
  }

  return undefined;
}

function resolveRequestPath(rootDir: string, pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  const normalized = normalize(decoded).replace(new RegExp(`^\\${sep}+`), "");
  return resolve(rootDir, normalized);
}

function buildServer(
  rootDir: string,
  host: string,
  port: number,
  defaultPath: string,
) {
  return createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
    const targetPath = resolveRequestPath(rootDir, reqUrl.pathname === "/" ? defaultPath : reqUrl.pathname);

    if (targetPath !== rootDir && !targetPath.startsWith(`${rootDir}${sep}`)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const targetStat = await stat(targetPath);
      if (!targetStat.isFile()) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const file = Bun.file(targetPath);
      const contentType = MIME_TYPES[extname(targetPath).toLowerCase()] ?? file.type ?? "application/octet-stream";
      res.writeHead(200, {
        "Content-Length": targetStat.size,
        "Content-Type": contentType,
      });

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      res.end(buffer);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function choosePort(host: string, startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 20; port += 1) {
    const available = await new Promise<boolean>((resolvePort) => {
      const server = createServer();
      server.once("error", () => resolvePort(false));
      server.listen(port, host, () => {
        server.close(() => resolvePort(true));
      });
    });

    if (available) {
      return port;
    }
  }

  throw new Error(`Could not find an open port starting at ${startPort}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const tilesetPath = resolve(rootDir, options.tileset);

  if (!(await pathExists(tilesetPath))) {
    throw new Error(`Tileset not found: ${tilesetPath}`);
  }
  if (!(await pathExists(resolve(VIEWER_DIST_DIR, "index.html")))) {
    throw new Error(`Viewer bundle not found: ${VIEWER_DIST_DIR}`);
  }

  const tilesetPort = await choosePort(options.host, options.port);
  const tilesetServer = buildServer(rootDir, options.host, tilesetPort, `/${options.tileset}`);
  await new Promise<void>((resolveStart, rejectStart) => {
    tilesetServer.once("error", rejectStart);
    tilesetServer.listen(tilesetPort, options.host, () => resolveStart());
  });
  const viewerPort = await choosePort(options.host, options.viewerPort);
  const viewerServer = buildServer(VIEWER_DIST_DIR, options.host, viewerPort, "/index.html");
  await new Promise<void>((resolveStart, rejectStart) => {
    viewerServer.once("error", rejectStart);
    viewerServer.listen(viewerPort, options.host, () => resolveStart());
  });

  const tilesetPathForUrl = options.tileset.split(sep).join("/");
  const loopbackTilesetUrl = new URL(tilesetPathForUrl, `http://127.0.0.1:${tilesetPort}/`).toString();
  const tailscaleIp = getTailscaleIpv4();
  const tailscaleTilesetUrl = tailscaleIp
    ? new URL(tilesetPathForUrl, `http://${tailscaleIp}:${tilesetPort}/`).toString()
    : undefined;
  const viewerBaseUrl = getViewerBaseUrl(options.viewerUrl);
  const localViewerLoopbackUrl = buildViewerUrl(`http://127.0.0.1:${viewerPort}/`, loopbackTilesetUrl);
  const localViewerTailscaleUrl = tailscaleTilesetUrl && tailscaleIp
    ? buildViewerUrl(`http://${tailscaleIp}:${viewerPort}/`, tailscaleTilesetUrl)
    : undefined;

  console.log(`Serving ${rootDir}`);
  console.log(`Local viewer bundle: ${VIEWER_DIST_DIR}`);
  console.log(`Loopback tileset URL: ${loopbackTilesetUrl}`);
  if (tailscaleTilesetUrl) {
    console.log(`Tailscale tileset URL: ${tailscaleTilesetUrl}`);
  } else {
    console.log("Tailscale tileset URL: unavailable");
  }
  console.log(`Local viewer URL (loopback): ${localViewerLoopbackUrl}`);
  if (localViewerTailscaleUrl) {
    console.log(`Local viewer URL (tailscale): ${localViewerTailscaleUrl}`);
  } else {
    console.log("Local viewer URL (tailscale): unavailable");
  }

  if (viewerBaseUrl) {
    console.log(`Pages viewer URL (loopback): ${buildViewerUrl(viewerBaseUrl, loopbackTilesetUrl)}`);
    if (tailscaleTilesetUrl) {
      console.log(`Pages viewer URL (tailscale): ${buildViewerUrl(viewerBaseUrl, tailscaleTilesetUrl)}`);
    }
  } else {
    console.log("Pages viewer URL: unavailable");
    console.log(
      "Set package.json homepage or pass --viewer-url https://<user>.github.io/<repo>/ to print the GitHub Pages link.",
    );
  }

  const shutdown = () => {
    tilesetServer.close(() => {
      viewerServer.close(() => process.exit(0));
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
