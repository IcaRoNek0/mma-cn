// MapHost: the single interface every map surface (editor map, minimap) binds to.
// Hosts wrap a concrete basemap engine (Google Maps via opensv, MapLibre GL for
// vector tiles) behind one camera/event/overlay contract so consumers never
// branch on the engine. Engine-only features reach the raw engine through
// `hostInstance(host, kind)` and degrade when the active host is a different engine.

import type { Layer, PickingInfo } from "@deck.gl/core";
import type * as maplibregl from "maplibre-gl";
import type { LatLng, Bounds, MapTypeKey } from "@/types";
import type { MapEmbedPrefs } from "@/store/mapEmbedPrefs";
import type { CustomStyle } from "@/lib/geo/mapStack";

export interface HostInstances {
	google: google.maps.Map;
	maplibre: maplibregl.Map;
}

export type MapHostKind = keyof HostInstances;

export interface DeckOverlayProps {
	layers: Layer[];
	// domEvent is the normalized native event (hosts unwrap their engine's wrapper).
	onClick?: (info: PickingInfo, domEvent?: Event) => void;
	onHover?: (info: PickingInfo, domEvent?: Event) => void;
	onError?: (e: unknown) => void;
}

export interface DeckOverlayHandle {
	setProps(props: Partial<DeckOverlayProps>): void;
	finalize(): void;
}

export interface MapHostEvents {
	mousemove: LatLng;
	mousedown: LatLng;
	mouseup: LatLng;
	mouseout: void;
	zoom: void;
	camera: void;
	tilesloaded: void;
}

export interface BasemapOpts {
	customStyles: CustomStyle[];
}

export interface MapHostContract<K extends MapHostKind = MapHostKind> {
	readonly kind: K;
	// The engine's visible map div: toasts anchor here, DOM listeners attach here.
	readonly container: HTMLElement;
	// Raw engine escape hatch; typed by `kind`. Prefer `hostInstance(host, kind)`.
	getHostInstance(): HostInstances[K];

	// Camera. Zoom is always Google-scale (world = 256px at z0); hosts normalize.
	getZoom(): number;
	setZoom(zoom: number): void;
	getCenter(): LatLng | null;
	getBounds(): Bounds | null;
	panTo(p: LatLng): void;
	moveCamera(opts: { center?: LatLng; zoom?: number }): void;
	fitBounds(bounds: Bounds, padding?: number, opts?: { snap?: boolean }): void;

	on<K extends keyof MapHostEvents>(event: K, fn: (arg: MapHostEvents[K]) => void): () => void;
	once<K extends keyof MapHostEvents>(event: K, fn: (arg: MapHostEvents[K]) => void): () => void;

	containerPxToLatLng(x: number, y: number): LatLng | null;
	setDraggable(v: boolean): void;
	/** CSS cursor over the map; null restores the host's default. */
	setCursor(v: string | null): void;
	setDoubleClickZoom(v: boolean): void;

	createDeckOverlay(): DeckOverlayHandle;
	// Route a synthetic click at the coordinate through the deck click pipeline.
	triggerClickAt(latLng: LatLng): void;

	applyPrefs(prefs: MapEmbedPrefs, opts: BasemapOpts): void;
	resize(): void;
	destroy(): void;
}

// Discriminated union over the registered kinds, so `host.kind === "x"` narrows
// getHostInstance() to that engine's type.
export type MapHost = { [K in MapHostKind]: MapHostContract<K> }[MapHostKind];

/** The raw engine instance if `host` is of the given kind, else null. */
export function hostInstance<K extends MapHostKind>(
	host: MapHost | null,
	kind: K,
): HostInstances[K] | null {
	return host?.kind === kind ? (host.getHostInstance() as HostInstances[K]) : null;
}

export function hostKindForMapType(mapType: MapTypeKey): MapHostKind {
	void mapType;
	return "maplibre";
}

export interface CreateHostOpts extends BasemapOpts {
	camera?: { center: LatLng; zoom: number };
	// Show the engine's scale control (editor map only).
	scaleControl?: boolean;
}

export async function createMapHost(
	kind: MapHostKind,
	container: HTMLElement,
	prefs: MapEmbedPrefs,
	opts: CreateHostOpts,
): Promise<MapHost> {
	void kind;
	const { createMapLibreHost } = await import("@/lib/map/maplibreHost");
	return createMapLibreHost(container, prefs, opts);
}

/** Axis-aligned bounds of [lng, lat] coords (or LatLng points). */
export function boundsOfCoords(coords: Iterable<LatLng>): Bounds | null {
	let west = Infinity,
		south = Infinity,
		east = -Infinity,
		north = -Infinity;
	for (const p of coords) {
		if (p.lng < west) west = p.lng;
		if (p.lat < south) south = p.lat;
		if (p.lng > east) east = p.lng;
		if (p.lat > north) north = p.lat;
	}
	if (!Number.isFinite(west)) return null;
	return { west, south, east, north };
}
