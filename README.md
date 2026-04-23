# Simple 3D Tiles Viewer

Cesium viewer for testing local `tileset.json` trees, with a `nix run` launcher that serves the current directory with CORS.

## Local usage

From any directory containing a `tileset.json`:

```sh
nix run github:3dgi/tv
```

To force a rebuild of the viewer app:

```sh
nix run --refesh github:3dgi/tv
```
This is only necessary if this repo had an update.

Optional flags:

```sh
nix run github:3dgi/tv -- --port 8090 --tileset path/to/tileset.json
```

The command starts a local static server with permissive CORS headers and prints:

- the local tileset URL
- a local viewer URL

The viewer includes a `Terrain` selector with three modes:

- `None`
- `Cesium World Terrain` (requires a Cesium Ion token)
- `PDOK Quantized Mesh` via `https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections/digitaalterreinmodel/quantized-mesh`

The selected terrain mode is persisted in the URL as the `terrain` query parameter.
