# Simple 3D Tiles Viewer

Cesium viewer for testing local `tileset.json` trees, with a `nix run` launcher that serves the current directory with CORS.

## Usage

From any directory containing a `tileset.json`:

```sh
nix run github:3dgi/tv
```

To force a rebuild of the viewer app:

```sh
nix run --refresh github:3dgi/tv
```
This is only necessary if this repo had an update.

Optional flags:

```sh
nix run github:3dgi/tv -- --port 8090 --tileset path/to/tileset.json
```

## Local development

Run from the local repository:

```sh
git clone git@github.com:3DGI/tv.git
cd ./tv
nix run .
```

To force a rebuild of your local checkout:

```sh
nix run --refresh .
```

Run from a directory containing `tileset.json`:

```sh
cd /path/to/tileset-dir
nix run --refresh ./tv
```

Serve a tileset from a different directory:

```sh
nix run --refresh ./tv -- --tileset /path/to/tileset-dir/tileset.json
```

Optional flags:

```sh
nix run --refresh ./tv -- --port 8090 --viewer-port 8091 --tileset /path/to/tileset.json
```

The command starts a local static server with permissive CORS headers and prints:

- the local tileset URL
- a local viewer URL

The viewer includes a `Terrain` selector with three modes:

- `None`
- `Cesium World Terrain` (requires a Cesium Ion token)
- `PDOK Quantized Mesh` via `https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections/digitaalterreinmodel/quantized-mesh`

The selected terrain mode is persisted in the URL as the `terrain` query parameter.
