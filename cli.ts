import { createServer } from "node:http";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import packageJson from "./package.json" with { type: "json" };

type CliOptions = {
  host: string;
  port: number;
  tileset: string;
  viewerUrl?: string;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const DEFAULT_TILESET = "tileset.json";
const PLACEHOLDER_GITHUB_USERNAME = "YOUR_GITHUB_USERNAME";

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
  --port <port>             Starting port (default: ${DEFAULT_PORT})
  --tileset <path>          Tileset path relative to cwd (default: ${DEFAULT_TILESET})
  --viewer-url <url>        Override the deployed viewer URL
  -h, --help                Show help
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
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

function resolveRequestPath(rootDir: string, pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  const normalized = normalize(decoded).replace(new RegExp(`^\\${sep}+`), "");
  return resolve(rootDir, normalized);
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

  const port = await choosePort(options.host, options.port);
  const server = createServer(async (req, res) => {
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

    const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? `${options.host}:${port}`}`);
    const targetPath = resolveRequestPath(rootDir, reqUrl.pathname === "/" ? `/${options.tileset}` : reqUrl.pathname);

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

  await new Promise<void>((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(port, options.host, () => resolveStart());
  });

  const localTilesetUrl = new URL(options.tileset.split(sep).join("/"), `http://${options.host}:${port}/`).toString();
  const viewerBaseUrl = getViewerBaseUrl(options.viewerUrl);

  console.log(`Serving ${rootDir}`);
  console.log(`Tileset URL: ${localTilesetUrl}`);

  if (viewerBaseUrl) {
    console.log(`Viewer URL: ${buildViewerUrl(viewerBaseUrl, localTilesetUrl)}`);
  } else {
    console.log("Viewer URL: unavailable");
    console.log(
      "Set package.json homepage or pass --viewer-url https://<user>.github.io/<repo>/ to print the GitHub Pages link.",
    );
  }

  const shutdown = () => {
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
