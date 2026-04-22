// Cesium is loaded as a global via /cesium/Cesium.js in index.html.
// We only use its types here — it is not bundled.
declare const Cesium: typeof import("cesium");
type Cesium3DTileset = import("cesium").Cesium3DTileset;

const urlInput = document.getElementById("url-input") as HTMLInputElement;
const tokenInput = document.getElementById("token-input") as HTMLInputElement;
const loadBtn = document.getElementById("load-btn") as HTMLButtonElement;
const searchParams = new URLSearchParams(window.location.search);

const viewer = new Cesium.Viewer("cesiumContainer", {
  animation: false,
  timeline: false,
  geocoder: false,
  baseLayerPicker: true,
  sceneModePicker: true,
  shouldAnimate: false,
  requestRenderMode: true,
  maximumRenderTimeChange: Infinity,
});

const DEFAULT_TILESET_URL = "http://localhost:8080/tileset.json";
const DEFAULT_TOKEN = "";

let currentTileset: Cesium3DTileset | null = null;

function applyToken() {
  const t = tokenInput.value.trim();
  if (t) Cesium.Ion.defaultAccessToken = t;
}

function updateQuery(url: string, token: string) {
  const next = new URL(window.location.href);
  next.searchParams.set("tileset", url);
  if (token) {
    next.searchParams.set("token", token);
  } else {
    next.searchParams.delete("token");
  }
  window.history.replaceState({}, "", next);
}

async function loadTileset(url: string) {
  applyToken();

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
    updateQuery(url, tokenInput.value.trim());
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
  updateQuery(urlInput.value.trim(), tokenInput.value.trim());
});

const initialTileset = searchParams.get("tileset") ?? DEFAULT_TILESET_URL;
const initialToken = searchParams.get("token") ?? DEFAULT_TOKEN;

urlInput.value = initialTileset;
tokenInput.value = initialToken;
loadTileset(initialTileset);
