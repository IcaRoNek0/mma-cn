// MapLibre GL MapHost: vector-tile basemaps (OpenFreeMap styles) with the SV
// coverage raster layered on top and deck.gl markers via MapboxOverlay.
//
// Zoom normalization: MapLibre's zoom 0 fits the world in 512px, Google's in
// 256px, so googleZoom = maplibreZoom + 1. The host contract is Google-scale;
// every camera call converts at the boundary.
//
// China coverage uses provider-specific paths: Baidu raster tiles use a
// main-thread custom protocol, while Tencent PMTiles are decoded and rendered
// through a dedicated deck.gl overlay.

import * as maplibregl from "maplibre-gl";
import { type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import { baiduCoverageProtocol } from "@/lib/map/baiduCoverage";
import {
	activeChinaPanoProvider,
	activeCoverageOpacity,
	activeCoverageProviders,
	chinaBasemapStyle,
	COVERAGE_LAYER_PREFIX,
} from "@/lib/map/chinaBasemap";
import { TencentCoverageOverlay } from "@/lib/map/tencentCoverageOverlay";
import { coverageDebug, coverageError } from "@/lib/map/coverageDebug";
import type { MapEmbedPrefs } from "@/store/mapEmbedPrefs";
import { getSettings, normalizeInputSensitivity } from "@/store/settings";
import { subscribe } from "@/lib/events";
import type { LatLng, Bounds } from "@/types";
import type {
	MapHost,
	MapHostContract,
	MapHostEvents,
	BasemapOpts,
	CreateHostOpts,
	DeckOverlayHandle,
	DeckOverlayProps,
} from "@/lib/map/host";

const ZOOM_OFFSET = 1;
// Keep the host/display zoom offset while allowing raster tiles to overzoom.
const MAX_HOST_ZOOM = 23;
const TRACKPAD_ZOOM_RATE = 1 / 100;
const WHEEL_ZOOM_RATE = 1 / 450;

const PREFETCH_MARGIN = 128;

// Raster (SV) tiles queue behind MapLibre's global image-request cap (default 16);
// vector tiles don't, so the basemap outruns SV coverage without this.
maplibregl.setWorkerUrl(workerUrl);
maplibregl.setMaxParallelImageRequests(64);

maplibregl.addProtocol("mma-baidu", baiduCoverageProtocol);
coverageDebug("map", "coverage protocol registered", { baidu: "mma-baidu://" });

type MlEventName =
	| "mousemove"
	| "mousedown"
	| "mouseup"
	| "mouseout"
	| "zoom"
	| "move"
	| "load"
	| "idle";

const EVENT_NAMES: Record<keyof MapHostEvents, MlEventName> = {
	mousemove: "mousemove",
	mousedown: "mousedown",
	mouseup: "mouseup",
	mouseout: "mouseout",
	zoom: "zoom",
	camera: "move",
	tilesloaded: "load",
	idle: "idle",
};

const LATLNG_EVENTS = new Set<keyof MapHostEvents>(["mousemove", "mousedown", "mouseup"]);

// MapboxOverlay builds mock mjolnir events with MapLibre's wrapper as srcEvent, so
// mjolnir.js's own event types (srcEvent: DOM event) are wrong here - don't import them.
type DeckEvent = { srcEvent?: MapMouseEvent };

function domEventOf(ev: DeckEvent): Event | undefined {
	return ev?.srcEvent?.originalEvent;
}

class MapLibreDeckOverlay implements DeckOverlayHandle {
	overlay: MapboxOverlay;
	props: Partial<DeckOverlayProps> = {};
	private finalized = false;

	private map: maplibregl.Map;
	private onFinalize: (self: MapLibreDeckOverlay) => void;
	constructor(map: maplibregl.Map, onFinalize: (self: MapLibreDeckOverlay) => void) {
		this.map = map;
		this.onFinalize = onFinalize;
		this.overlay = new MapboxOverlay({ interleaved: false, layers: [], pickingRadius: 2 });
		map.addControl(this.overlay);
	}

	setProps(props: Partial<DeckOverlayProps>) {
		if (this.finalized) return;
		Object.assign(this.props, props);
		const out: Record<string, unknown> = {};
		if (props.layers) out.layers = props.layers;
		if ("onError" in props) out.onError = props.onError;
		if ("onClick" in props) {
			const fn = props.onClick;
			out.onClick = fn ? (info: PickingInfo, ev: DeckEvent) => fn(info, domEventOf(ev)) : undefined;
		}
		if ("onHover" in props) {
			const fn = props.onHover;
			out.onHover = fn ? (info: PickingInfo, ev: DeckEvent) => fn(info, domEventOf(ev)) : undefined;
		}
		this.overlay.setProps(out);
	}

	pickAt(x: number, y: number, lngLat: { lng: number; lat: number }): PickingInfo {
		const picked = this.overlay.pickObject({ x, y, radius: 2 });
		if (picked) return picked;
		return {
			coordinate: [lngLat.lng, lngLat.lat],
			x,
			y,
			index: -1,
			picked: false,
		} as unknown as PickingInfo;
	}

	finalize() {
		if (this.finalized) return;
		this.finalized = true;
		this.map.removeControl(this.overlay);
		this.onFinalize(this);
	}
}

class MapLibreHost implements MapHostContract<"maplibre"> {
	readonly kind = "maplibre" as const;
	readonly map: maplibregl.Map;
	private overlays = new Set<MapLibreDeckOverlay>();
	private readonly tencentCoverage: TencentCoverageOverlay;
	private prefs: MapEmbedPrefs;
	private unsubscribeSettings: () => void = () => {};

	private outer: HTMLElement;
	private mapDiv: HTMLDivElement;

	constructor(container: HTMLElement, prefs: MapEmbedPrefs, opts: CreateHostOpts) {
		this.prefs = prefs;
		// Oversized, clipped inner container = tile prefetch margin (see PREFETCH_MARGIN).
		this.outer = container;
		if (!container.style.position) container.style.position = "relative";
		container.style.overflow = "hidden";
		this.mapDiv = document.createElement("div");
		this.mapDiv.style.cssText = `position:absolute;inset:-${PREFETCH_MARGIN}px`;
		container.appendChild(this.mapDiv);
		const camera = opts.camera ?? { center: { lat: 0, lng: 0 }, zoom: 2 };
		this.map = new maplibregl.Map({
			container: this.mapDiv,
			style: chinaBasemapStyle(prefs),
			center: [camera.center.lng, camera.center.lat],
			zoom: camera.zoom - ZOOM_OFFSET,
			minZoom: 0,
			maxZoom: MAX_HOST_ZOOM - ZOOM_OFFSET,
			maxPitch: 0,
			dragRotate: false,
			pitchWithRotate: false,
			attributionControl: false,
			renderWorldCopies: true,
			fadeDuration: 0,
			maxTileCacheZoomLevels: 10,
		});
		this.tencentCoverage = new TencentCoverageOverlay(this.map, ZOOM_OFFSET, () =>
			this.getBounds(),
		);
		this.map.touchZoomRotate.disableRotation();
		this.applyZoomSensitivity();
		this.unsubscribeSettings = subscribe("settings:changed", () => this.applyZoomSensitivity());
		this.map.keyboard.disable();
		// Cursor comes from a CSS class so handleMapHover's inline pointer/"" toggling
		// layers over it (inline "" must fall back to crosshair, not the engine default).
		this.map.getCanvas().classList.add("mma-vector-canvas");
		coverageDebug("map", "host created", {
			provider: activeChinaPanoProvider(prefs.panoProvider),
			opacity: activeCoverageOpacity(prefs.svOpacity),
			panoramas: prefs.svPanoramas,
			zoom: camera.zoom,
		});
		this.map.on("style.load", () => {
			this.syncCoverageLayers();
			this.debugCoverageState("style.load");
		});
		this.map.on("moveend", () => void this.tencentCoverage.refresh());
		this.map.on("sourcedataloading", (event) => {
			if (event.sourceId?.startsWith(COVERAGE_LAYER_PREFIX)) {
				coverageDebug("map", "source loading", { sourceId: event.sourceId });
			}
		});
		this.map.on("sourcedata", (event) => {
			if (event.sourceId?.startsWith(COVERAGE_LAYER_PREFIX)) {
				coverageDebug("map", "source data", {
					sourceId: event.sourceId,
					sourceDataType: event.sourceDataType,
					isSourceLoaded: event.isSourceLoaded,
				});
			}
		});
		this.map.on("error", (event) => {
			const sourceId = (event as { sourceId?: unknown }).sourceId;
			if (typeof sourceId === "string" && sourceId.startsWith(COVERAGE_LAYER_PREFIX)) {
				coverageError("map", `source error: ${sourceId}`, event.error);
			}
		});

		this.map.on("contextmenu", (e) => {
			e.preventDefault();
			e.originalEvent?.preventDefault();
			for (const o of this.overlays) {
				const onClick = o.props.onClick;
				if (!onClick) continue;
				onClick(o.pickAt(e.point.x, e.point.y, e.lngLat), e.originalEvent);
			}
		});
	}

	// The visible container: DOM listeners and toasts anchor here. Events from the
	// inner map canvas bubble up to it. Pixel math converts via PREFETCH_MARGIN.
	get container(): HTMLElement {
		return this.outer;
	}

	getHostInstance(): maplibregl.Map {
		return this.map;
	}

	private applyZoomSensitivity() {
		const sensitivity = normalizeInputSensitivity(getSettings().mapZoomSensitivity);
		this.map.scrollZoom.setZoomRate(TRACKPAD_ZOOM_RATE * sensitivity);
		this.map.scrollZoom.setWheelZoomRate(WHEEL_ZOOM_RATE * sensitivity);
		this.map.touchZoomRotate.setZoomRate(sensitivity);
	}

	private debugCoverageState(reason: string) {
		const baiduId = `${COVERAGE_LAYER_PREFIX}-baidu`;
		const tencent = this.tencentCoverage.getDebugState();
		coverageDebug("map", `state (${reason})`, {
			provider: activeChinaPanoProvider(this.prefs.panoProvider),
			opacity: activeCoverageOpacity(this.prefs.svVisible ? this.prefs.svOpacity : 0),
			panoramas: this.prefs.svPanoramas,
			zoom: this.getZoom(),
			styleLoaded: this.map.isStyleLoaded(),
			baiduSource: Boolean(this.map.getSource(`${COVERAGE_LAYER_PREFIX}-baidu`)),
			baiduLayer: Boolean(this.map.getLayer(baiduId)),
			baiduVisibility: this.map.getLayer(baiduId)
				? this.map.getLayoutProperty(baiduId, "visibility")
				: null,
			tencentOverlayActive: tencent.active,
			tencentFeatures: tencent.features,
			tencentDataZoom: tencent.dataZoom,
		});
	}

	private syncCoverageLayers() {
		const provider = activeChinaPanoProvider(this.prefs.panoProvider);
		const opacity = activeCoverageOpacity(this.prefs.svVisible ? this.prefs.svOpacity : 0);
		const active = activeCoverageProviders(
			this.prefs.panoProvider,
			this.prefs.svVisible ? this.prefs.svOpacity : 0,
		);
		const baiduId = `${COVERAGE_LAYER_PREFIX}-baidu`;
		if (this.map.getLayer(baiduId)) {
			this.map.setLayoutProperty(baiduId, "visibility", active.baidu ? "visible" : "none");
			this.map.setPaintProperty(baiduId, "raster-opacity", opacity);
		}
		this.tencentCoverage.setPreferences({
			active: active.tencent,
			opacity,
			color: this.prefs.svColor,
			thin: this.prefs.svThickness === "high",
		});
		coverageDebug("map", "coverage provider synchronized", {
			provider,
			baiduActive: active.baidu,
			tencentActive: active.tencent,
		});
	}

	getZoom() {
		return this.map.getZoom() + ZOOM_OFFSET;
	}

	setZoom(zoom: number) {
		this.map.setZoom(zoom - ZOOM_OFFSET);
	}

	getCenter(): LatLng | null {
		const c = this.map.getCenter();
		return { lat: c.lat, lng: c.lng };
	}

	getBounds(): Bounds | null {
		// Bounds of the visible window, not the oversized map container.
		const m = PREFETCH_MARGIN;
		const nw = this.map.unproject([m, m]);
		const se = this.map.unproject([m + this.outer.clientWidth, m + this.outer.clientHeight]);
		return { west: nw.lng, south: se.lat, east: se.lng, north: nw.lat };
	}

	panTo(p: LatLng) {
		this.map.panTo([p.lng, p.lat]);
	}

	moveCamera(opts: { center?: LatLng; zoom?: number }) {
		this.map.jumpTo({
			...(opts.center ? { center: [opts.center.lng, opts.center.lat] as [number, number] } : {}),
			...(opts.zoom != null ? { zoom: opts.zoom - ZOOM_OFFSET } : {}),
		});
	}

	fitBounds(bounds: Bounds, padding?: number, opts?: { snap?: boolean }) {
		this.map.fitBounds(
			[
				[bounds.west, bounds.south],
				[bounds.east, bounds.north],
			],
			// Padding fits the bounds inside the visible window, past the prefetch bleed.
			{ padding: (padding ?? 45) + PREFETCH_MARGIN, animate: !opts?.snap },
		);
	}

	on<K extends keyof MapHostEvents>(event: K, fn: (arg: MapHostEvents[K]) => void): () => void {
		const name = EVENT_NAMES[event];
		const handler = (e?: unknown) => {
			if (LATLNG_EVENTS.has(event)) {
				const lngLat = (e as maplibregl.MapMouseEvent | undefined)?.lngLat;
				if (!lngLat) return;
				(fn as (arg: LatLng) => void)({ lat: lngLat.lat, lng: lngLat.lng });
			} else {
				(fn as () => void)();
			}
		};
		this.map.on(name, handler);
		return () => this.map.off(name, handler);
	}

	once<K extends keyof MapHostEvents>(event: K, fn: (arg: MapHostEvents[K]) => void): () => void {
		const off = this.on(event, (arg) => {
			off();
			fn(arg);
		});
		return off;
	}

	containerPxToLatLng(x: number, y: number): LatLng | null {
		// Callers pass pixels relative to the visible container; shift into map space.
		const ll = this.map.unproject([x + PREFETCH_MARGIN, y + PREFETCH_MARGIN]);
		return { lat: ll.lat, lng: ll.lng };
	}

	setCursor(v: string | null) {
		this.map.getCanvas().style.cursor = v ?? "";
	}

	setDraggable(v: boolean) {
		if (v) this.map.dragPan.enable();
		else this.map.dragPan.disable();
	}

	setDoubleClickZoom(v: boolean) {
		if (v) this.map.doubleClickZoom.enable();
		else this.map.doubleClickZoom.disable();
	}

	createDeckOverlay(): DeckOverlayHandle {
		const handle = new MapLibreDeckOverlay(this.map, (self) => this.overlays.delete(self));
		this.overlays.add(handle);
		return handle;
	}

	triggerClickAt(latLng: LatLng) {
		const px = this.map.project([latLng.lng, latLng.lat]);
		for (const o of this.overlays) {
			o.props.onClick?.(o.pickAt(px.x, px.y, { lng: latLng.lng, lat: latLng.lat }), undefined);
		}
	}

	applyPrefs(prefs: MapEmbedPrefs, _opts: BasemapOpts) {
		this.prefs = prefs;
		if (!this.map.isStyleLoaded()) {
			coverageDebug("map", "preferences queued before style load", {
				provider: activeChinaPanoProvider(prefs.panoProvider),
				opacity: activeCoverageOpacity(prefs.svOpacity),
				panoramas: prefs.svPanoramas,
			});
			return;
		}
		this.syncCoverageLayers();
		this.debugCoverageState("applyPrefs");
	}

	resize() {
		this.map.resize();
	}

	destroy() {
		this.unsubscribeSettings();
		for (const o of [...this.overlays]) o.finalize();
		this.tencentCoverage.destroy();
		this.map.remove();
		this.mapDiv.remove();
	}
}

export function createMapLibreHost(
	container: HTMLElement,
	prefs: MapEmbedPrefs,
	opts: CreateHostOpts,
): MapHost {
	return new MapLibreHost(container, prefs, opts);
}
