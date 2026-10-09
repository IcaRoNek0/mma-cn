import { Viewer, events } from "@photo-sphere-viewer/core";
import "@photo-sphere-viewer/core/index.css";
import {
	EquirectangularTilesAdapter,
	type EquirectangularMultiTilesPanorama,
} from "@photo-sphere-viewer/equirectangular-tiles-adapter";
import type { Location, SeenEntry } from "@/bindings.gen";
import { createLocation } from "@/types";
import { getMapState, setActiveLocation, addLocations, resolveLocation } from "@/store/useMapStore";
import {
	getPanoramaProvider,
	fallbackPanoramaMetadata,
	headingToViewerYaw,
	isPanoSource,
	panoramaYawOrigin,
	type PanoramaMetadata,
	type PanoSource,
	viewerYawToHeading,
} from "@/lib/pano";
import { movementCandidates, selectMoveLink, type PanoMoveDirection } from "@/lib/pano/movement";
import { getLocal } from "@/lib/hooks/useLocalStorage";
import { DEFAULT_PREFS } from "@/store/mapEmbedPrefs";
import { getSettings, normalizeInputSensitivity } from "@/store/settings";
import { subscribe } from "@/lib/events";

interface ListenerHandle {
	remove(): void;
}

export interface PsvMoveMarker {
	panoId: string;
	heading: number;
	distance: number;
	x: number;
	y: number;
	scale: number;
	visible: boolean;
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
const PSV_BASE_MOVE_SPEED = 2.2;
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
	readonly container: HTMLDivElement;
	private viewer: Viewer;
	private location: Location | null = null;
	private unsubscribeSettings: () => void;
	private metadata: PanoramaMetadata | null = null;
	private source: PanoSource = "baidu_pano";
	private listeners = new Map<string, Set<() => void>>();
	private progressiveCleanup: () => void = () => {};
	private yawOriginHeading = 0;
	private generation = 0;
	private navigationHistory: string[] = [];
	private navigationLoading = false;

	constructor(container: HTMLDivElement = singletonDiv) {
		this.container = container;
		this.viewer = new Viewer({
			container,
			adapter: EquirectangularTilesAdapter,
			moveSpeed:
				PSV_BASE_MOVE_SPEED * normalizeInputSensitivity(getSettings().panoRotateSensitivity),
			moveInertia: 0.3,
			zoomSpeed: 2.5,
			defaultZoomLvl: 0,
			navbar: false,
		});
		const adapter = (this.viewer as unknown as { adapter: AdapterInternals }).adapter;
		adapter.queue.concurency = PSV_TILE_CONCURRENCY;
		this.viewer.addEventListener(events.PositionUpdatedEvent.type, () => this.emit("pov_changed"));
		this.viewer.addEventListener(events.ZoomUpdatedEvent.type, () => this.emit("zoom_changed"));
		this.unsubscribeSettings = subscribe("settings:changed", () => {
			this.viewer.setOption(
				"moveSpeed",
				PSV_BASE_MOVE_SPEED * normalizeInputSensitivity(getSettings().panoRotateSensitivity),
			);
		});
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

	async load(
		location: Location,
		panoId = location.panoId,
		options: { transition?: boolean; resetHistory?: boolean } = {},
	): Promise<PanoramaMetadata> {
		this.location = location;
		const generation = ++this.generation;
		const sourceValue = location.extra?.source;
		if (!isPanoSource(sourceValue))
			throw new Error("This location does not specify a Baidu/Tencent source");
		this.source = sourceValue;
		const provider = getPanoramaProvider(sourceValue);
		if (!panoId) {
			const nearest = await provider.findNearest({ lat: location.lat, lng: location.lng }, 18);
			if (!nearest) throw new Error("No panorama found near this location");
			panoId = nearest.panoId;
		}
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
		if (generation !== this.generation) return metadata;
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
		const previousYawOriginHeading = this.yawOriginHeading;
		const yawOriginHeading = panoramaYawOrigin(
			metadata.source,
			metadata.heading,
			metadata.northOffset,
		);
		this.yawOriginHeading = yawOriginHeading;
		try {
			await this.viewer.setPanorama(panorama, {
				position: {
					yaw: headingToViewerYaw(location.heading, yawOriginHeading),
					pitch: (location.pitch * Math.PI) / 180,
				},
				zoom: tileLevels.length > 1 ? 0 : targetZoom,
				transition: options.transition ?? false,
				speed: options.transition ? 300 : undefined,
			});
		} catch (error) {
			if (generation === this.generation) this.yawOriginHeading = previousYawOriginHeading;
			throw error;
		}
		if (generation !== this.generation) return metadata;
		this.metadata = metadata;
		this.source = metadata.source;
		if (options.resetHistory) {
			this.navigationHistory = [];
			this.emit("navigation_changed");
		}
		this.emit("pano_changed");
		this.emit("links_changed");
		if (tileLevels.length > 1) {
			this.progressiveCleanup = this.promoteHighResolution(generation, targetZoom);
		} else {
			this.emit("status_changed");
		}
		return metadata;
	}

	private currentLocationSnapshot(): Location | null {
		const active = this.location;
		if (!active || !this.metadata) return null;
		const pov = this.getPov();
		return {
			...active,
			lat: this.metadata.position.lat,
			lng: this.metadata.position.lng,
			heading: pov.heading,
			pitch: pov.pitch,
			zoom: this.getZoom(),
			panoId: this.metadata.panoId,
			extra: { ...active.extra, source: this.source },
		};
	}

	private async navigateToPano(panoId: string, transition: boolean): Promise<boolean> {
		if (this.navigationLoading || !panoId || panoId === this.metadata?.panoId) return false;
		const location = this.currentLocationSnapshot();
		if (!location) return false;
		this.navigationLoading = true;
		this.emit("navigation_changed");
		try {
			await this.load(location, panoId, { transition });
			return true;
		} finally {
			this.navigationLoading = false;
			this.emit("navigation_changed");
		}
	}

	setPano(panoId: string) {
		void this.navigateToPano(panoId, false)
			.then((changed) => {
				if (changed) {
					this.navigationHistory = [];
					this.emit("navigation_changed");
				}
			})
			.catch(() => {});
	}

	getMoveTarget(direction: PanoMoveDirection) {
		if (!this.metadata) return null;
		return selectMoveLink(
			this.metadata.links,
			this.metadata.position,
			this.getPov().heading,
			direction,
			this.navigationHistory.at(-1),
		);
	}

	async move(direction: PanoMoveDirection): Promise<boolean> {
		const target = this.getMoveTarget(direction);
		return target ? this.moveTo(target.panoId) : false;
	}

	async moveTo(panoId: string): Promise<boolean> {
		if (this.navigationLoading || !this.metadata) return false;
		if (!this.metadata.links.some((link) => link.panoId === panoId)) return false;
		const previousPanoId = this.metadata.panoId;
		const historyTarget = this.navigationHistory.at(-1);
		const changed = await this.navigateToPano(panoId, true);
		if (!changed) return false;
		if (panoId === historyTarget) this.navigationHistory.pop();
		else this.navigationHistory.push(previousPanoId);
		this.emit("navigation_changed");
		return true;
	}

	getMoveMarkers(): PsvMoveMarker[] {
		if (!this.metadata) return [];
		return movementCandidates(this.metadata.links, this.metadata.position).flatMap(
			({ link, distance, pitch, visible }) => {
				const position = {
					yaw: headingToViewerYaw(link.heading!, this.yawOriginHeading),
					pitch,
				};
				if (!this.viewer.dataHelper.isPointVisible(position)) return [];
				const point = this.viewer.dataHelper.sphericalCoordsToViewerCoords(position);
				return [
					{
						panoId: link.panoId,
						heading: link.heading!,
						distance,
						x: point.x,
						y: point.y,
						scale: 0.55 + 0.45 * (1 - distance / 100),
						visible,
					},
				];
			},
		);
	}

	async goBack(): Promise<boolean> {
		if (this.navigationLoading) return false;
		const target = this.navigationHistory.at(-1);
		if (!target) return false;
		const changed = await this.navigateToPano(target, true);
		if (changed) this.navigationHistory.pop();
		this.emit("navigation_changed");
		return changed;
	}

	canGoBack(): boolean {
		return !this.navigationLoading && this.navigationHistory.length > 0;
	}

	isNavigationLoading(): boolean {
		return this.navigationLoading;
	}

	getMetadata(): PanoramaMetadata | null {
		return this.metadata;
	}

	getPano(): string {
		return this.metadata?.panoId ?? "";
	}

	getPov(): google.maps.StreetViewPov {
		const position = this.viewer.getPosition();
		return {
			heading: viewerYawToHeading(position.yaw, this.yawOriginHeading),
			pitch: (position.pitch * 180) / Math.PI,
		};
	}

	setPov(pov: google.maps.StreetViewPov) {
		this.viewer.rotate({
			yaw: headingToViewerYaw(pov.heading, this.yawOriginHeading),
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
		this.container.style.display = visible ? "block" : "none";
		if (visible) this.viewer.autoSize();
	}

	setOptions() {}
	focus() {
		this.container.focus();
	}
	resize() {
		this.viewer.autoSize();
		this.emit("size_changed");
	}

	setPosition(point: google.maps.LatLngLiteral) {
		const source = this.metadata?.source ?? this.source;
		const generation = ++this.generation;
		void getPanoramaProvider(source)
			.findNearest(point, 18)
			.then((found) => {
				if (found && generation === this.generation)
					return this.load(createLocation({ ...point, panoId: found.panoId, extra: { source } }));
			})
			.catch(() => {});
	}

	destroy() {
		this.generation++;
		this.progressiveCleanup();
		this.unsubscribeSettings();
		this.viewer.destroy();
		this.listeners.clear();
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
	const metadata = await panorama.load(location, panoId, { resetHistory: true });
	panorama.focus();
	return metadata;
}

export async function loadSeenPano(entry: SeenEntry) {
	const fetched = entry.locationId != null ? await resolveLocation(entry.locationId) : null;
	const existing = fetched && fetched.panoId === entry.panoId ? fetched : null;
	if (existing) {
		if (getMapState().activeLocation?.id !== existing.id) await setActiveLocation(existing.id);
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
