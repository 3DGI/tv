// Cesium is loaded as a global via /cesium/Cesium.js in index.html.
// We only use its types here — it is not bundled.
declare const Cesium: typeof import("cesium");
type Cesium3DTileset = import("cesium").Cesium3DTileset;

const urlInput = document.getElementById("url-input") as HTMLInputElement;
const tokenInput = document.getElementById("token-input") as HTMLInputElement;
const terrainSelect = document.getElementById("terrain-select") as HTMLSelectElement;
const loadBtn = document.getElementById("load-btn") as HTMLButtonElement;
const searchParams = new URLSearchParams(window.location.search);

const viewer = new Cesium.Viewer("cesiumContainer", {
  animation: false,
  timeline: false,
  geocoder: true,
  baseLayerPicker: true,
  sceneModePicker: true,
  shouldAnimate: false,
  requestRenderMode: true,
  maximumRenderTimeChange: Infinity,
});

const DEFAULT_TILESET_URL = "http://localhost:8080/tileset.json";
const DEFAULT_TOKEN = "";
const PDOK_TERRAIN_URL = "https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections/digitaalterreinmodel/quantized-mesh";
const TERRAIN_NONE = "none";
const TERRAIN_CESIUM = "cesium";
const TERRAIN_PDOK = "pdok";
type TerrainMode = typeof TERRAIN_NONE | typeof TERRAIN_CESIUM | typeof TERRAIN_PDOK;
const DEFAULT_TERRAIN_MODE: TerrainMode = TERRAIN_NONE;

let currentTileset: Cesium3DTileset | null = null;
let terrainRequestId = 0;

function applyToken() {
  const t = tokenInput.value.trim();
  Cesium.Ion.defaultAccessToken = t;
}

function createEllipsoidTerrain() {
  return new Cesium.Terrain(Promise.resolve(new Cesium.EllipsoidTerrainProvider()));
}

function createPdokTerrain() {
  return new Cesium.Terrain(Cesium.CesiumTerrainProvider.fromUrl(PDOK_TERRAIN_URL, {
    requestVertexNormals: true,
  }));
}

function getTerrainMode(): TerrainMode {
  const value = terrainSelect.value;
  if (value === TERRAIN_CESIUM || value === TERRAIN_PDOK) return value;
  return TERRAIN_NONE;
}

function syncTerrain() {
  const requestId = ++terrainRequestId;
  const token = tokenInput.value.trim();
  const mode = getTerrainMode();
  const useCesiumWorldTerrain = mode === TERRAIN_CESIUM && Boolean(token);
  const usePdokTerrain = mode === TERRAIN_PDOK;
  const terrain = useCesiumWorldTerrain
    ? Cesium.Terrain.fromWorldTerrain({
        requestVertexNormals: true,
        requestWaterMask: true,
      })
    : usePdokTerrain
      ? createPdokTerrain()
      : createEllipsoidTerrain();

  terrain.readyEvent.addEventListener(() => {
    if (requestId !== terrainRequestId) return;

    viewer.scene.globe.depthTestAgainstTerrain = mode !== TERRAIN_NONE;
    viewer.scene.requestRender();
  });

  terrain.errorEvent.addEventListener((error) => {
    if (requestId !== terrainRequestId) return;

    console.error(error);
    alert(`Failed to configure terrain: ${error}`);
  });

  viewer.scene.setTerrain(terrain);
}

function updateQuery(url: string, token: string, terrainMode: TerrainMode) {
  const next = new URL(window.location.href);
  next.searchParams.set("tileset", url);
  if (token) {
    next.searchParams.set("token", token);
  } else {
    next.searchParams.delete("token");
  }
  if (terrainMode !== TERRAIN_NONE) {
    next.searchParams.set("terrain", terrainMode);
  } else {
    next.searchParams.delete("terrain");
  }
  window.history.replaceState({}, "", next);
}

async function loadTileset(url: string) {
  applyToken();
  syncTerrain();

  if (currentTileset) {
    viewer.scene.primitives.remove(currentTileset);
    currentTileset = null;
  }

  try {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
      showCreditsOnScreen: true,
      debugShowBoundingVolume: true
    });
    viewer.scene.primitives.add(tileset);
    currentTileset = tileset;
    updateQuery(url, tokenInput.value.trim(), getTerrainMode());
    await viewer.zoomTo(tileset);
  } catch (err: unknown) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    alert(`Failed to load tileset: ${msg}`);
  }
}

function triggerLoad() {
  const v = urlInput.value.trim();
  if (v) {
    loadTileset(v);
  }
}

loadBtn.addEventListener("click", () => {
  triggerLoad();
});
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    triggerLoad();
  }
});

tokenInput.addEventListener("change", () => {
  applyToken();
  syncTerrain();
  updateQuery(urlInput.value.trim(), tokenInput.value.trim(), getTerrainMode());
});

terrainSelect.addEventListener("change", () => {
  syncTerrain();
  updateQuery(urlInput.value.trim(), tokenInput.value.trim(), getTerrainMode());
});

const initialTileset = searchParams.get("tileset") ?? DEFAULT_TILESET_URL;
const initialToken = searchParams.get("token") ?? DEFAULT_TOKEN;
const initialTerrainParam = searchParams.get("terrain");
const initialTerrainMode: TerrainMode =
  initialTerrainParam === TERRAIN_CESIUM || initialTerrainParam === "1"
    ? TERRAIN_CESIUM
    : initialTerrainParam === TERRAIN_PDOK
      ? TERRAIN_PDOK
      : DEFAULT_TERRAIN_MODE;

urlInput.value = initialTileset;
tokenInput.value = initialToken;
terrainSelect.value = initialTerrainMode;
loadTileset(initialTileset);
