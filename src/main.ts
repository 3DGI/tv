// Cesium is loaded as a global via /cesium/Cesium.js in index.html.
// We only use its types here — it is not bundled.
declare const Cesium: typeof import("cesium");
type Cesium3DTileset = import("cesium").Cesium3DTileset;

const urlInput = document.getElementById("url-input") as HTMLInputElement;
const tokenInput = document.getElementById("token-input") as HTMLInputElement;
const terrainToggle = document.getElementById("terrain-toggle") as HTMLInputElement;
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
const DEFAULT_TERRAIN_ENABLED = false;

let currentTileset: Cesium3DTileset | null = null;
let terrainRequestId = 0;

function applyToken() {
  const t = tokenInput.value.trim();
  Cesium.Ion.defaultAccessToken = t;
}

function createEllipsoidTerrain() {
  return new Cesium.Terrain(Promise.resolve(new Cesium.EllipsoidTerrainProvider()));
}

function syncTerrain() {
  const requestId = ++terrainRequestId;
  const token = tokenInput.value.trim();
  const shouldUseWorldTerrain = terrainToggle.checked && Boolean(token);
  const terrain = shouldUseWorldTerrain
    ? Cesium.Terrain.fromWorldTerrain({
        requestVertexNormals: true,
        requestWaterMask: true,
      })
    : createEllipsoidTerrain();

  terrain.readyEvent.addEventListener(() => {
    if (requestId !== terrainRequestId) return;

    viewer.scene.globe.depthTestAgainstTerrain = shouldUseWorldTerrain;
    viewer.scene.requestRender();
  });

  terrain.errorEvent.addEventListener((error) => {
    if (requestId !== terrainRequestId) return;

    console.error(error);
    alert(`Failed to configure terrain: ${error}`);
  });

  viewer.scene.setTerrain(terrain);
}

function updateQuery(url: string, token: string, terrainEnabled: boolean) {
  const next = new URL(window.location.href);
  next.searchParams.set("tileset", url);
  if (token) {
    next.searchParams.set("token", token);
  } else {
    next.searchParams.delete("token");
  }
  if (terrainEnabled) {
    next.searchParams.set("terrain", "1");
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
    updateQuery(url, tokenInput.value.trim(), terrainToggle.checked);
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
  updateQuery(urlInput.value.trim(), tokenInput.value.trim(), terrainToggle.checked);
});

terrainToggle.addEventListener("change", () => {
  syncTerrain();
  updateQuery(urlInput.value.trim(), tokenInput.value.trim(), terrainToggle.checked);
});

const initialTileset = searchParams.get("tileset") ?? DEFAULT_TILESET_URL;
const initialToken = searchParams.get("token") ?? DEFAULT_TOKEN;
const initialTerrainEnabled = searchParams.get("terrain") === "1" || DEFAULT_TERRAIN_ENABLED;

urlInput.value = initialTileset;
tokenInput.value = initialToken;
terrainToggle.checked = initialTerrainEnabled;
loadTileset(initialTileset);
