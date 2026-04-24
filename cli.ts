import { createServer } from "node:http";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, normalize, relative, resolve, sep } from "node:path";

type CliOptions = {
  host: string;
  port: number;
  viewerPort: number;
  tileset: string;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9010;
const DEFAULT_VIEWER_PORT = 9011;
const DEFAULT_TILESET = "tileset.json";
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
  ".subtree": "application/octet-stream",
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
  -h, --help                Show help
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    viewerPort: DEFAULT_VIEWER_PORT,
    tileset: DEFAULT_TILESET,
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

function buildServer(
  rootDir: string,
  host: string,
  port: number,
  defaultPath: string,
) {
  return createServer(async (req, res) => {
    const requestOrigin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", typeof requestOrigin === "string" ? requestOrigin : "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader(
      "Vary",
      "Origin, Access-Control-Request-Headers, Access-Control-Request-Method, Access-Control-Request-Private-Network",
    );

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
  const cwd = process.cwd();
  const tilesetPath = resolve(cwd, options.tileset);

  if (!(await pathExists(tilesetPath))) {
    throw new Error(`Tileset not found: ${tilesetPath}`);
  }
  if (!(await pathExists(resolve(VIEWER_DIST_DIR, "index.html")))) {
    throw new Error(`Viewer bundle not found: ${VIEWER_DIST_DIR}`);
  }

  const tilesetIsInCwd = tilesetPath === cwd || tilesetPath.startsWith(`${cwd}${sep}`);
  const tilesetRootDir = tilesetIsInCwd ? cwd : dirname(tilesetPath);
  const tilesetPathForUrl = (
    tilesetIsInCwd ? relative(cwd, tilesetPath) : basename(tilesetPath)
  ).split(sep).join("/");

  const tilesetPort = await choosePort(options.host, options.port);
  const tilesetServer = buildServer(tilesetRootDir, options.host, tilesetPort, `/${tilesetPathForUrl}`);
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

  const loopbackTilesetUrl = new URL(tilesetPathForUrl, `http://127.0.0.1:${tilesetPort}/`).toString();
  const localViewerLoopbackUrl = buildViewerUrl(`http://127.0.0.1:${viewerPort}/`, loopbackTilesetUrl);

  console.log(`Serving ${tilesetRootDir}`);
  console.log(`Loopback tileset URL: ${loopbackTilesetUrl}`);
  console.log(`Local viewer URL (loopback): ${localViewerLoopbackUrl}`);

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
