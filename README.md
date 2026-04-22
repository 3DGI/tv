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
- the GitHub Pages viewer URL with `?tileset=...`

You can also override the deployed viewer URL explicitly:

```sh
nix run github:3dgi/tv -- --viewer-url https://3dgi.github.io/tv/
```
