import { Viewer, events } from "@photo-sphere-viewer/core";
import "@photo-sphere-viewer/core/index.css";
import {
	EquirectangularTilesAdapter,
	type EquirectangularMultiTilesPanorama,
} from "@photo-sphere-viewer/equirectangular-tiles-adapter";
import type { Location, SeenEntry } from "@/bindings.gen";
import { createLocation } from "@/types";
import { getMapState, setActiveLocation, addLocations, fetchLocation } from "@/store/useMapStore";
import {
	getPanoramaProvider,
	fallbackPanoramaMetadata,
	isPanoSource,
	type PanoramaMetadata,
	type PanoSource,
} from "@/lib/pano";
import { seenSkipNext } from "@/lib/seen/seen";
import { getLocal } from "@/lib/hooks/useLocalStorage";
import { DEFAULT_PREFS } from "@/store/mapEmbedPrefs";

interface ListenerHandle {
	remove(): void;
}

interface AdapterInternals {
	state: { tileConfig: { level: number } | null };
	queue: {
		concurency: number;
		tasks: Record<string, { status: number }>;
		runningTasks: Record<string, boolean>;
	};
}

const HIGH_RES_THRESHOLD = 0.01;
const HIGH_RES_ZOOM = 0.02;
export const PSV_TILE_CONCURRENCY = 8;

function thumbnailUrl(metadata: PanoramaMetadata): string | undefined {
	const panoId = encodeURIComponent(metadata.panoId);
	if (metadata.source === "baidu_pano") {
		return `https://mapsv0.bdimg.com/?qt=pdata&sid=${panoId}&pos=0_0&z=1`;
	}
	if (metadata.source === "qq_pano") {
		const seed = Number.parseInt(metadata.panoId.slice(-1), 10) || 0;
		const server = (seed % 4) + 1;
		return `https://sv${server}.map.qq.com/thumb?from=web&svid=${panoId}`;
	}
	return undefined;
}

function viewerTileLevels(metadata: PanoramaMetadata) {
	if (metadata.source !== "qq_pano") return metadata.tileLevels;
	const high = metadata.tileLevels.find((level) => level.level === 1);
	return high ? [high] : metadata.tileLevels;
}

export const singletonDiv = (() => {
	const element = document.createElement("div");
	Object.assign(element.style, { width: "100%", height: "100%", background: "#000" });
	return element;
})();

export class PsvPanoramaController {
	private viewer: Viewer;
	private metadata: PanoramaMetadata | null = null;
	private source: PanoSource = "baidu_pano";
	private listeners = new Map<string, Set<() => void>>();
	private progressiveCleanup: () => void = () => {};
	private generation = 0;

	constructor() {
		this.viewer = new Viewer({
			container: singletonDiv,
			adapter: EquirectangularTilesAdapter,
			moveSpeed: 2.2,
			moveInertia: 0.3,
			zoomSpeed: 2.5,
			defaultZoomLvl: 0,
			navbar: false,
		});
		const adapter = (this.viewer as unknown as { adapter: AdapterInternals }).adapter;
		adapter.queue.concurency = PSV_TILE_CONCURRENCY;
		this.viewer.addEventListener(events.PositionUpdatedEvent.type, () => this.emit("pov_changed"));
		this.viewer.addEventListener(events.ZoomUpdatedEvent.type, () => this.emit("zoom_changed"));
	}

	private emit(event: string) {
		for (const listener of this.listeners.get(event) ?? []) listener();
	}

	addListener(event: string, listener: () => void): ListenerHandle {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener);
		return { remove: () => set?.delete(listener) };
	}

	private promoteHighResolution(generation: number, targetZoom: number): () => void {
		const adapter = (this.viewer as unknown as { adapter: AdapterInternals }).adapter;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		let promoted = false;
		const startedAt = Date.now();
		const keepHighResolution = () => {
			if (promoted && this.viewer.getZoomLevel() < HIGH_RES_ZOOM) {
				this.viewer.zoom(HIGH_RES_ZOOM);
			}
		};
		const promote = () => {
			if (stopped || promoted || generation !== this.generation) return;
			promoted = true;
			this.viewer.addEventListener(events.ZoomUpdatedEvent.type, keepHighResolution);
			this.viewer.zoom(Math.max(targetZoom, HIGH_RES_ZOOM));
			this.emit("status_changed");
		};
		const waitForLowTiles = () => {
			if (stopped || generation !== this.generation) return;
			const pending = Object.values(adapter.queue.tasks).some((task) => task.status > 0);
			const running = Object.keys(adapter.queue.runningTasks).length > 0;
			if (adapter.state.tileConfig?.level === 0 && !pending && !running) {
				promote();
				return;
			}
			if (Date.now() - startedAt >= 15_000) {
				promote();
				return;
			}
			timer = setTimeout(waitForLowTiles, 50);
		};
		waitForLowTiles();
		return () => {
			stopped = true;
			if (timer) clearTimeout(timer);
			this.viewer.removeEventListener(events.ZoomUpdatedEvent.type, keepHighResolution);
		};
	}

	async load(location: Location, panoId = location.panoId): Promise<PanoramaMetadata> {
		if (!panoId) throw new Error("This location does not have a panorama ID");
		const sourceValue = location.extra?.source;
		if (!isPanoSource(sourceValue))
			throw new Error("This location does not specify a Baidu/Tencent source");
		this.source = sourceValue;
		const provider = getPanoramaProvider(sourceValue);
		let metadata: PanoramaMetadata;
		try {
			metadata = await provider.getMetadata(panoId);
		} catch {
			// Existing tile-only locations remain viewable even when sdata/sv
			// metadata has expired or is temporarily unavailable.
			metadata = fallbackPanoramaMetadata(this.source, panoId, {
				lat: location.lat,
				lng: location.lng,
			});
		}
		// A Tencent standard lookup can resolve to a Trekker pano. Use the
		// provider matching the resolved metadata for its tile URL contract.
		const tileProvider =
			metadata.source === sourceValue ? provider : getPanoramaProvider(metadata.source);
		const generation = ++this.generation;
		this.progressiveCleanup();
		const targetZoom = Math.max(0, Math.min(100, location.zoom * 20));
		const tileLevels = viewerTileLevels(metadata);
		const levels = tileLevels.map((level, index, all) => ({
			zoomRange: [
				index === 0 ? 0 : HIGH_RES_THRESHOLD,
				index === all.length - 1 ? 100 : HIGH_RES_THRESHOLD,
			] as [number, number],
			width: level.width,
			cols: level.cols,
			rows: level.rows,
		}));
		const panorama: EquirectangularMultiTilesPanorama = {
			levels,
			tileUrl: (col, row, level) =>
				tileProvider.getTileUrl(metadata.panoId, col, row, tileLevels[level]?.level ?? level),
			baseUrl: thumbnailUrl(metadata),
		};
		await this.viewer.setPanorama(panorama, {
			position: {
				yaw: (location.heading * Math.PI) / 180,
				pitch: (location.pitch * Math.PI) / 180,
			},
			zoom: tileLevels.length > 1 ? 0 : targetZoom,
			transition: false,
		});
		if (generation !== this.generation) return metadata;
		this.metadata = metadata;
		this.source = metadata.source;
		this.emit("pano_changed");
		this.emit("links_changed");
		if (tileLevels.length > 1) {
			this.progressiveCleanup = this.promoteHighResolution(generation, targetZoom);
		} else {
			this.emit("status_changed");
		}
		return metadata;
	}

	setPano(panoId: string) {
		const active = getMapState().activeLocation;
		if (!active) return;
		void this.load({ ...active, extra: { ...active.extra, source: this.source } }, panoId);
	}

	getPano(): string {
		return this.metadata?.panoId ?? "";
	}

	getPov(): google.maps.StreetViewPov {
		const position = this.viewer.getPosition();
		return {
			heading: ((position.yaw * 180) / Math.PI + 360) % 360,
			pitch: (position.pitch * 180) / Math.PI,
		};
	}

	setPov(pov: google.maps.StreetViewPov) {
		this.viewer.rotate({
			yaw: (pov.heading * Math.PI) / 180,
			pitch: (pov.pitch * Math.PI) / 180,
		});
	}

	getZoom(): number {
		return this.viewer.getZoomLevel() / 20;
	}

	setZoom(zoom: number) {
		this.viewer.zoom(Math.max(0, Math.min(100, zoom * 20)));
	}

	getPosition(): google.maps.LatLng | null {
		if (!this.metadata) return null;
		const { lat, lng } = this.metadata.position;
		return { lat: () => lat, lng: () => lng } as google.maps.LatLng;
	}

	getLocation(): google.maps.StreetViewLocation | null {
		const latLng = this.getPosition();
		return this.metadata && latLng ? { pano: this.metadata.panoId, latLng } : null;
	}

	getLinks(): google.maps.StreetViewLink[] {
		return (this.metadata?.links ?? []).map((link) => ({
			pano: link.panoId,
			heading: link.heading ?? 0,
			description: link.label ?? "",
		}));
	}

	getStatus(): string {
		return this.metadata ? "OK" : "ZERO_RESULTS";
	}

	setVisible(visible: boolean) {
		singletonDiv.style.display = visible ? "block" : "none";
		if (visible) this.viewer.autoSize();
	}

	setOptions() {}
	focus() {
		singletonDiv.focus();
	}
	resize() {
		this.viewer.autoSize();
	}
}

export let singletonPano: PsvPanoramaController | null = null;

export function getPanorama(): PsvPanoramaController {
	if (!singletonPano) singletonPano = new PsvPanoramaController();
	return singletonPano;
}

export function clearSingletonPano() {
	if (singletonPano) singletonPano.setVisible(false);
}

export async function applyLocationPanorama(location: Location, panoId?: string) {
	const panorama = getPanorama();
	panorama.setVisible(true);
	const metadata = await panorama.load(location, panoId);
	panorama.focus();
	return metadata;
}

export async function loadSeenPano(entry: SeenEntry) {
	seenSkipNext(entry.panoId);
	const fetched = entry.locationId != null ? await fetchLocation(entry.locationId) : null;
	const existing = fetched && fetched.panoId === entry.panoId ? fetched : null;
	if (existing) {
		if (getMapState().activeLocation?.id !== existing.id) setActiveLocation(existing.id);
		return;
	}
	const provider = getLocal("mapEmbedPrefs", DEFAULT_PREFS).panoProvider ?? "baidu";
	const source: PanoSource = provider === "baidu" ? "baidu_pano" : "qq_pano";
	const location = createLocation({
		lat: entry.lat,
		lng: entry.lng,
		heading: entry.heading,
		pitch: entry.pitch,
		zoom: entry.zoom,
		panoId: entry.panoId,
		extra: { countryCode: entry.countryCode, source },
	});
	await addLocations([location]);
	await setActiveLocation(location.id, false);
}
