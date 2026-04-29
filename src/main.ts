// Cesium is loaded as a global via /cesium/Cesium.js in index.html.
// We only use its types here — it is not bundled.
declare const Cesium: typeof import("cesium");
type Color = import("cesium").Color;
type Cesium3DTileset = import("cesium").Cesium3DTileset;
type Cesium3DTileFeature = import("cesium").Cesium3DTileFeature;
type Cesium3DTileContent = {
  featuresLength: number;
  getFeature(index: number): Cesium3DTileFeature;
};
type Cesium3DTile = {
  content: Cesium3DTileContent;
};
type SelectedFeatureState = {
  featureId: number;
  feature?: Cesium3DTileFeature;
  originalColor: Color;
};

const urlInput = document.getElementById("url-input") as HTMLInputElement;
const tokenInput = document.getElementById("token-input") as HTMLInputElement;
const terrainSelect = document.getElementById("terrain-select") as HTMLSelectElement;
const underpassColorToggle = document.getElementById("underpass-color-toggle") as HTMLInputElement;
const underpassLegend = document.getElementById("underpass-legend") as HTMLDivElement;
const loadBtn = document.getElementById("load-btn") as HTMLButtonElement;
const zoomBtn = document.getElementById("zoom-btn") as HTMLButtonElement;
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
const DEFAULT_UNDERPASS_COLORS_ENABLED = false;
const PDOK_TERRAIN_URL = "https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections/digitaalterreinmodel/quantized-mesh";
const TERRAIN_NONE = "none";
const TERRAIN_CESIUM = "cesium";
const TERRAIN_PDOK = "pdok";
type TerrainMode = typeof TERRAIN_NONE | typeof TERRAIN_CESIUM | typeof TERRAIN_PDOK;
const DEFAULT_TERRAIN_MODE: TerrainMode = TERRAIN_PDOK;
const SELECTION_HIGHLIGHT_COLOR = new Cesium.Color(0.25, 0.78, 1.0, 0.9);
const UNDERPASS_SUCCESS_STYLE = new Cesium.Cesium3DTileStyle({
  color: {
    conditions: [
      [
        "(${add_underpass_success} === 1 || ${add_underpass_success} === '1') && (${h_underpass_status} === 'success' || ${h_underpass_status} === null || ${h_underpass_status} === undefined)",
        "color('#8fd694')",
      ],
      ["${add_underpass_success} === 0 || ${add_underpass_success} === '0'", "color('#f08f8f')"],
      [
        "${h_underpass_status} !== 'success' && ${h_underpass_status} !== '' && ${h_underpass_status} !== null && ${h_underpass_status} !== undefined",
        "color('#b84a4a')",
      ],
      ["true", "color('white')"],
    ],
  },
});

let currentTileset: Cesium3DTileset | null = null;
let terrainRequestId = 0;
let selectedFeatureState: SelectedFeatureState | undefined;

function normalizeTilesetUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const isLoopbackHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const looksLikeFilesystemPath =
      parsed.pathname.startsWith("/home/") ||
      parsed.pathname.startsWith("/Users/") ||
      parsed.pathname.startsWith("/private/");

    if (isLoopbackHost && looksLikeFilesystemPath) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      const tail = parts[parts.length - 1];
      if (tail) {
        parsed.pathname = `/${tail}`;
        return parsed.toString();
      }
    }

    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function formatAngle(value: number) {
  return `${value.toFixed(6)} deg`;
}

function formatHeight(value: number) {
  return `${value.toFixed(2)} m`;
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

function cloneColor(color: Color, result?: Color) {
  return Cesium.Color.clone(color, result ?? new Cesium.Color())!;
}

function getTileFeatureById(tile: Cesium3DTile, featureId: number) {
  const { content } = tile;
  for (let index = 0; index < content.featuresLength; index += 1) {
    const feature = content.getFeature(index);
    if (feature.featureId === featureId) {
      return feature;
    }
  }

  return undefined;
}

function clearSelection() {
  if (!selectedFeatureState) {
    return;
  }

  const { feature, originalColor } = selectedFeatureState;
  if (feature) {
    feature.color = cloneColor(originalColor);
  }

  selectedFeatureState = undefined;
  viewer.scene.requestRender();
}

function selectFeature(feature: Cesium3DTileFeature) {
  if (selectedFeatureState?.feature === feature) {
    return;
  }

  clearSelection();
  selectedFeatureState = {
    featureId: feature.featureId,
    feature,
    originalColor: cloneColor(feature.color),
  };
  feature.color = cloneColor(SELECTION_HIGHLIGHT_COLOR);
  viewer.scene.requestRender();
}

function restoreSelectionOnTileUnload(tile: Cesium3DTile) {
  const state = selectedFeatureState;
  if (!state || !state.feature) {
    return;
  }

  const feature = getTileFeatureById(tile, state.featureId);
  if (!feature || feature !== state.feature) {
    return;
  }

  feature.color = cloneColor(state.originalColor);
  state.feature = undefined;
  viewer.scene.requestRender();
}

function reapplySelectionOnTileVisible(tile: Cesium3DTile) {
  const state = selectedFeatureState;
  if (!state || state.feature) {
    return;
  }

  const feature = getTileFeatureById(tile, state.featureId);
  if (!feature) {
    return;
  }

  state.feature = feature;
  feature.color = cloneColor(SELECTION_HIGHLIGHT_COLOR);
  viewer.scene.requestRender();
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

  featureSection.className = "section selected";

  const selectedBadge = document.createElement("div");
  selectedBadge.className = "selection-badge";
  selectedBadge.textContent = "Selected feature";
  featureSection.appendChild(selectedBadge);

  appendLine(featureSection, "Feature ID", String(pickedFeature.featureId));
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
    if (pickedFeature) {
      selectFeature(pickedFeature);
    } else {
      clearSelection();
    }
    const cartesian = getPickedPosition(event.position);
    renderInspection(cartesian, pickedFeature);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function attachTilesetSelectionLifecycle(tileset: Cesium3DTileset) {
  tileset.tileUnload.addEventListener(restoreSelectionOnTileUnload);
  tileset.tileVisible.addEventListener(reapplySelectionOnTileVisible);
}

function detachTilesetSelectionLifecycle(tileset: Cesium3DTileset) {
  tileset.tileUnload.removeEventListener(restoreSelectionOnTileUnload);
  tileset.tileVisible.removeEventListener(reapplySelectionOnTileVisible);
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

function syncUnderpassLegend() {
  underpassLegend.hidden = !underpassColorToggle.checked;
}

function syncUnderpassStyle() {
  syncUnderpassLegend();
  if (!currentTileset) return;

  clearSelection();
  currentTileset.style = underpassColorToggle.checked ? UNDERPASS_SUCCESS_STYLE : undefined;
  currentTileset.makeStyleDirty();
  viewer.scene.requestRender();
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

function updateQuery(url: string, token: string, terrainMode: TerrainMode, underpassColorsEnabled: boolean) {
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
  if (underpassColorsEnabled) {
    next.searchParams.set("underpassColors", "1");
  } else {
    next.searchParams.delete("underpassColors");
  }
  window.history.replaceState({}, "", next);
}

async function loadTileset(url: string) {
  applyToken();
  syncTerrain();

  try {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
      showCreditsOnScreen: true,
      debugShowBoundingVolume: true
    });

    if (currentTileset) {
      clearSelection();
      detachTilesetSelectionLifecycle(currentTileset);
      viewer.scene.primitives.remove(currentTileset);
      currentTileset = null;
    }

    viewer.scene.primitives.add(tileset);
    attachTilesetSelectionLifecycle(tileset);
    currentTileset = tileset;
    syncUnderpassStyle();
    updateQuery(url, tokenInput.value.trim(), getTerrainMode(), underpassColorToggle.checked);
    await viewer.zoomTo(tileset);
  } catch (err: unknown) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    alert(`Failed to load tileset: ${msg}`);
  }
}

async function zoomToCurrentTileset() {
  if (!currentTileset) return;

  try {
    await viewer.zoomTo(currentTileset);
  } catch (err: unknown) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    alert(`Failed to zoom to tileset: ${msg}`);
  }
}

function triggerLoad() {
  const v = normalizeTilesetUrl(urlInput.value);
  if (v) {
    urlInput.value = v;
    loadTileset(v);
  }
}

loadBtn.addEventListener("click", () => {
  triggerLoad();
});
zoomBtn.addEventListener("click", () => {
  zoomToCurrentTileset();
});
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    triggerLoad();
  }
});

tokenInput.addEventListener("change", () => {
  applyToken();
  syncTerrain();
  updateQuery(urlInput.value.trim(), tokenInput.value.trim(), getTerrainMode(), underpassColorToggle.checked);
});

terrainSelect.addEventListener("change", () => {
  syncTerrain();
  updateQuery(urlInput.value.trim(), tokenInput.value.trim(), getTerrainMode(), underpassColorToggle.checked);
});

underpassColorToggle.addEventListener("change", () => {
  syncUnderpassStyle();
  updateQuery(urlInput.value.trim(), tokenInput.value.trim(), getTerrainMode(), underpassColorToggle.checked);
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
const initialUnderpassColorsEnabled = searchParams.get("underpassColors") === "1" || DEFAULT_UNDERPASS_COLORS_ENABLED;

urlInput.value = normalizeTilesetUrl(initialTileset);
tokenInput.value = initialToken;
terrainSelect.value = initialTerrainMode;
underpassColorToggle.checked = initialUnderpassColorsEnabled;
setupInspector();
loadTileset(urlInput.value);
