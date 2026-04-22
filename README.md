# 3D Tiles Tester

Cesium viewer for testing local `tileset.json` trees, with a GitHub Pages deployment target and a `nix run` launcher that serves the current directory with CORS.

## Local usage

From any directory containing a `tileset.json`:

```sh
nix run github:3dgi/tv
```

Optional flags:

```sh
nix run github:3dgi/tv -- --port 8090 --tileset path/to/tileset.json
```

The command starts a local static server with permissive CORS headers and prints:

- the local tileset URL
- a local viewer URL that works in Safari because both the viewer and tileset are served over `http`
- the GitHub Pages viewer URL with `?tileset=...`

Safari blocks `https -> http` tileset requests as mixed content, so the local viewer URL is the one to use for local testing there.
On the first `nix run`, the launcher bootstraps a cached local app directory, runs `bun install`, and builds the viewer before starting the servers.

You can also override the deployed viewer URL explicitly:

```sh
nix run github:3dgi/tv -- --viewer-url https://3dgi.github.io/tv/
```
