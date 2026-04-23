// Cesium is loaded as a global via /cesium/Cesium.js in index.html.
// We only use its types here — it is not bundled.
declare const Cesium: typeof import("cesium");
type Cesium3DTileset = import("cesium").Cesium3DTileset;
type Cesium3DTileFeature = import("cesium").Cesium3DTileFeature;

const urlInput = document.getElementById("url-input") as HTMLInputElement;
const tokenInput = document.getElementById("token-input") as HTMLInputElement;
const terrainSelect = document.getElementById("terrain-select") as HTMLSelectElement;
const loadBtn = document.getElementById("load-btn") as HTMLButtonElement;
const inspectContent = document.getElementById("inspect-content") as HTMLDivElement;
const searchParams = new URLSearchParams(window.location.search);

const viewer = new Cesium.Viewer("cesiumContainer", {
  animation: false,
  timeline: false,
  geocoder: true,
  baseLayerPicker: true,
  homeButton: false,
  sceneModePicker: false,
  baseLayer: new Cesium.ImageryLayer(
    new Cesium.OpenStreetMapImageryProvider({
      url: "https://tile.openstreetmap.org/",
    })
  ),
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
const DEFAULT_TERRAIN_MODE: TerrainMode = TERRAIN_PDOK;

let currentTileset: Cesium3DTileset | null = null;
let terrainRequestId = 0;

function formatAngle(value: number) {
  return `${value.toFixed(6)} deg`;
}

function formatHeight(value: number) {
  return `${value.toFixed(2)} m`;
}

function formatPropertyValue(value: unknown) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function appendLine(container: HTMLElement, label: string, value: string) {
  const row = document.createElement("div");
  const labelEl = document.createElement("span");
  labelEl.className = "label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  container.appendChild(row);
}

function renderInspection(
  cartesian: import("cesium").Cartesian3 | undefined,
  pickedFeature: Cesium3DTileFeature | undefined
) {
  inspectContent.replaceChildren();

  if (!cartesian) {
    inspectContent.textContent = "No world position was resolved for that click.";
    inspectContent.className = "hint";
    return;
  }

  inspectContent.className = "";

  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  appendLine(inspectContent, "Longitude", formatAngle(Cesium.Math.toDegrees(cartographic.longitude)));
  appendLine(inspectContent, "Latitude", formatAngle(Cesium.Math.toDegrees(cartographic.latitude)));
  appendLine(inspectContent, "Height", formatHeight(cartographic.height));

  const featureSection = document.createElement("div");
  featureSection.className = "section";
  inspectContent.appendChild(featureSection);

  if (!pickedFeature) {
    featureSection.textContent = "No 3D Tiles feature picked.";
    return;
  }

  appendLine(featureSection, "Feature ID", String(pickedFeature.featureId));

  const propertyIds = pickedFeature.getPropertyIds().sort((a, b) => a.localeCompare(b));
  if (propertyIds.length === 0) {
    const noProps = document.createElement("div");
    noProps.textContent = "Picked feature has no feature properties.";
    featureSection.appendChild(noProps);
    return;
  }

  const propertiesTitle = document.createElement("div");
  propertiesTitle.textContent = "Properties";
  featureSection.appendChild(propertiesTitle);

  const propertiesPre = document.createElement("pre");
  propertiesPre.textContent = propertyIds
    .map((propertyId) => `${propertyId}: ${formatPropertyValue(pickedFeature.getProperty(propertyId))}`)
    .join("\n");
  featureSection.appendChild(propertiesPre);
}

function getPickedPosition(windowPosition: import("cesium").Cartesian2) {
  if (viewer.scene.pickPositionSupported) {
    const pickedPosition = viewer.scene.pickPosition(windowPosition);
    if (Cesium.defined(pickedPosition)) return pickedPosition;
  }

  return viewer.camera.pickEllipsoid(windowPosition, viewer.scene.globe.ellipsoid);
}

function setupInspector() {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((event: { position: import("cesium").Cartesian2 }) => {
    const picked = viewer.scene.pick(event.position);
    const pickedFeature = picked instanceof Cesium.Cesium3DTileFeature ? picked : undefined;
    const cartesian = getPickedPosition(event.position);
    renderInspection(cartesian, pickedFeature);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

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
setupInspector();
loadTileset(initialTileset);
