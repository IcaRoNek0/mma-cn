// MapLibre GL MapHost: vector-tile basemaps (OpenFreeMap styles) with the SV
// coverage raster layered on top and deck.gl markers via MapboxOverlay.
//
// Zoom normalization: MapLibre's zoom 0 fits the world in 512px, Google's in
// 256px, so googleZoom = maplibreZoom + 1. The host contract is Google-scale;
// every camera call converts at the boundary.
//
// SV tiles: MapLibre raster sources take URL templates, not functions, so the
// source uses a fake `mma-sv://{z}/{x}/{y}` template and `transformRequest`
// rewrites each request through the current SV tile source.

import * as maplibregl from "maplibre-gl";
import { type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import { Protocol } from "pmtiles";
import { baiduCoverageProtocol } from "@/lib/map/baiduCoverage";
import { chinaBasemapStyle, TENCENT_COVERAGE_URL } from "@/lib/map/chinaBasemap";
import { cachedTencentCoverage, TENCENT_COVERAGE_ARCHIVE_KEY } from "@/lib/map/tencentCoverage";
import type { MapEmbedPrefs } from "@/store/mapEmbedPrefs";
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
const COVERAGE_SOURCE = "mma-cn-coverage";
const COVERAGE_LAYER_PREFIX = "mma-cn-coverage";

const PREFETCH_MARGIN = 128;

// Raster (SV) tiles queue behind MapLibre's global image-request cap (default 16);
// vector tiles don't, so the basemap outruns SV coverage without this.
maplibregl.setMaxParallelImageRequests(64);

const protocolState = globalThis as typeof globalThis & { __mmaCnProtocols?: boolean };
if (!protocolState.__mmaCnProtocols) {
	const pmtiles = new Protocol();
	pmtiles.add(cachedTencentCoverage(TENCENT_COVERAGE_URL));
	maplibregl.addProtocol("pmtiles", pmtiles.tile);
	maplibregl.addProtocol("mma-baidu", baiduCoverageProtocol);
	protocolState.__mmaCnProtocols = true;
}

type MlEventName = "mousemove" | "mousedown" | "mouseup" | "mouseout" | "zoom" | "move" | "load";

const EVENT_NAMES: Record<keyof MapHostEvents, MlEventName> = {
	mousemove: "mousemove",
	mousedown: "mousedown",
	mouseup: "mouseup",
	mouseout: "mouseout",
	zoom: "zoom",
	camera: "move",
	tilesloaded: "load",
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

	constructor(
		private map: maplibregl.Map,
		private onFinalize: (self: MapLibreDeckOverlay) => void,
	) {
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
	private prefs: MapEmbedPrefs;

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
			style: chinaBasemapStyle(),
			center: [camera.center.lng, camera.center.lat],
			zoom: camera.zoom - ZOOM_OFFSET,
			minZoom: 0,
			maxZoom: 21,
			maxPitch: 0,
			dragRotate: false,
			pitchWithRotate: false,
			attributionControl: false,
			renderWorldCopies: true,
			fadeDuration: 0,
			maxTileCacheZoomLevels: 10,
		});
		this.map.touchZoomRotate.disableRotation();
		this.map.keyboard.disable();
		// Cursor comes from a CSS class so handleMapHover's inline pointer/"" toggling
		// layers over it (inline "" must fall back to crosshair, not the engine default).
		this.map.getCanvas().classList.add("mma-vector-canvas");
		this.map.on("style.load", () => this.addCoverageLayers());

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

	private coverageLayerIds(): string[] {
		return (this.map.getStyle().layers ?? [])
			.map((layer) => layer.id)
			.filter((id) => id.startsWith(COVERAGE_LAYER_PREFIX));
	}

	private removeCoverageLayers() {
		for (const id of this.coverageLayerIds()) this.map.removeLayer(id);
		if (this.map.getSource(COVERAGE_SOURCE)) this.map.removeSource(COVERAGE_SOURCE);
	}

	private addCoverageLayers() {
		if (!this.map.isStyleLoaded() || this.map.getSource(COVERAGE_SOURCE)) return;
		const opacity = this.prefs.svOpacity;
		if ((this.prefs.panoProvider ?? "baidu") === "baidu") {
			this.map.addSource(COVERAGE_SOURCE, {
				type: "raster",
				tiles: ["mma-baidu://tiles/{z}/{x}/{y}"],
				tileSize: 256,
				minzoom: 0,
				maxzoom: 20,
			});
			this.map.addLayer({
				id: `${COVERAGE_LAYER_PREFIX}-baidu`,
				type: "raster",
				source: COVERAGE_SOURCE,
				paint: {
					"raster-opacity": opacity,
					"raster-hue-rotate": 140,
					"raster-saturation": 1,
					"raster-fade-duration": 0,
				},
			});
			return;
		}

		this.map.addSource(COVERAGE_SOURCE, {
			type: "vector",
			url: `pmtiles://${TENCENT_COVERAGE_ARCHIVE_KEY}`,
			minzoom: 0,
			maxzoom: 11,
		});
		for (const sourceLayer of ["sv", "ccf"]) {
			this.map.addLayer({
				id: `${COVERAGE_LAYER_PREFIX}-tencent-${sourceLayer}`,
				type: "line",
				source: COVERAGE_SOURCE,
				"source-layer": sourceLayer,
				paint: {
					"line-color": this.prefs.svColor,
					"line-opacity": opacity,
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						3,
						this.prefs.svThickness === "high" ? 7 : 5,
						8,
						this.prefs.svThickness === "high" ? 3 : 1,
					],
				},
			});
		}
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
		const previous = this.prefs;
		this.prefs = prefs;
		if (!this.map.isStyleLoaded()) return;
		const coverageChanged =
			(previous.panoProvider ?? "baidu") !== (prefs.panoProvider ?? "baidu") ||
			previous.svColor !== prefs.svColor ||
			previous.svThickness !== prefs.svThickness;
		if (coverageChanged) {
			this.removeCoverageLayers();
			this.addCoverageLayers();
			return;
		}
		for (const id of this.coverageLayerIds()) {
			this.map.setPaintProperty(
				id,
				id.endsWith("baidu") ? "raster-opacity" : "line-opacity",
				prefs.svOpacity,
			);
		}
	}

	resize() {
		this.map.resize();
	}

	destroy() {
		for (const o of [...this.overlays]) o.finalize();
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
