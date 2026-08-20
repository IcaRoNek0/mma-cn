import type { Feature, FeatureCollection, Geometry } from "geojson";
import { GeoJsonLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { VectorTile } from "@mapbox/vector-tile";
import * as maplibregl from "maplibre-gl";
import { PbfReader } from "pbf";
import { coverageError } from "@/lib/map/coverageDebug";
import { bundledTencentCoverage } from "@/lib/map/tencentCoverage";
import { hexToRgb, resolveSvColorHex } from "@/lib/util/color";
import type { Bounds } from "@/types";

const MIN_DISPLAY_ZOOM = 3;
const MAX_DATA_ZOOM = 11;
const PREFETCH_MIN_ZOOM = 8;
const TILE_CACHE_SIZE = 64;
const CASING_COLOR: [number, number, number] = [186, 200, 255];

type TileCoordinate = {
	z: number;
	x: number;
	y: number;
};

export type TencentCoverageOverlayPrefs = {
	active: boolean;
	opacity: number;
	color: string;
	thin: boolean;
};

type DecodedTile = {
	data: FeatureCollection;
	sv: number;
	ccf: number;
};

type VisibleTile = {
	key: string;
	decoded: DecodedTile;
};

function tileAt(lng: number, lat: number, z: number): TileCoordinate {
	const scale = 2 ** z;
	const clampedLat = Math.min(85.05112878, Math.max(-85.05112878, lat));
	return {
		z,
		x: Math.floor(((lng + 180) / 360) * scale),
		y: Math.floor(((1 - Math.asinh(Math.tan((clampedLat * Math.PI) / 180)) / Math.PI) / 2) * scale),
	};
}

function tileKey(tile: TileCoordinate): string {
	return `${tile.z}/${tile.x}/${tile.y}`;
}

function visibleTiles(bounds: Bounds, z: number, margin: number): TileCoordinate[] {
	const northWest = tileAt(bounds.west, bounds.north, z);
	const southEast = tileAt(bounds.east, bounds.south, z);
	const maximum = 2 ** z - 1;
	const minX = Math.max(0, Math.min(maximum, northWest.x - margin));
	const maxX = Math.max(0, Math.min(maximum, southEast.x + margin));
	const minY = Math.max(0, Math.min(maximum, northWest.y - margin));
	const maxY = Math.max(0, Math.min(maximum, southEast.y + margin));
	const tiles: TileCoordinate[] = [];
	for (let x = minX; x <= maxX; x++) {
		for (let y = minY; y <= maxY; y++) tiles.push({ z, x, y });
	}
	return tiles;
}

function errorText(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Renders local Tencent PMTiles as cached, viewport-scoped deck.gl tile layers. */
export class TencentCoverageOverlay {
	private readonly archive = bundledTencentCoverage();
	private readonly overlay: MapboxOverlay;
	private readonly tileCache = new Map<string, DecodedTile>();
	private prefs: TencentCoverageOverlayPrefs = {
		active: false,
		opacity: 0.5,
		color: "#4263eb",
		thin: false,
	};
	private lineColorHex = "#4263eb";
	private lineColor: [number, number, number] = [66, 99, 235];
	private visible: VisibleTile[] = [];
	private abortController: AbortController | null = null;
	private loadSequence = 0;
	private disposed = false;
	private lastDataZoom: number | null = null;

	constructor(
		private readonly map: maplibregl.Map,
		private readonly displayZoomOffset: number,
		private readonly getVisibleBounds: () => Bounds | null,
	) {
		this.overlay = new MapboxOverlay({
			interleaved: false,
			layers: [],
			onError: (error) => coverageError("tencent", "deck.gl render failed", error),
		});
		map.addControl(this.overlay);
	}

	setPreferences(prefs: TencentCoverageOverlayPrefs) {
		const wasActive = this.prefs.active;
		this.prefs = prefs;
		const resolvedColor = resolveSvColorHex(prefs.color);
		if (resolvedColor !== this.lineColorHex) {
			this.lineColorHex = resolvedColor;
			this.lineColor = hexToRgb(resolvedColor);
		}
		if (!prefs.active || prefs.opacity <= 0) {
			this.clearVisible();
			return;
		}
		if (this.visible.length > 0) this.render();
		if (!wasActive || this.visible.length === 0) void this.refresh();
	}

	async refresh() {
		if (this.disposed || !this.prefs.active || this.prefs.opacity <= 0) return;
		const displayZoom = this.map.getZoom() + this.displayZoomOffset;
		const bounds = this.getVisibleBounds();
		if (displayZoom < MIN_DISPLAY_ZOOM || !bounds) {
			this.clearVisible();
			return;
		}

		const sequence = ++this.loadSequence;
		this.abortController?.abort();
		const abortController = new AbortController();
		this.abortController = abortController;
		const z = Math.min(MAX_DATA_ZOOM, Math.max(0, Math.floor(displayZoom)));
		const margin = displayZoom < PREFETCH_MIN_ZOOM ? 0 : 1;
		const tiles = visibleTiles(bounds, z, margin);

		try {
			const visible = await Promise.all(
				tiles.map(async (tile): Promise<VisibleTile> => {
					const key = tileKey(tile);
					const cached = this.getCachedTile(key);
					if (cached) return { key, decoded: cached };
					const decoded = await this.decodeTile(tile, abortController.signal);
					this.cacheTile(key, decoded);
					return { key, decoded };
				}),
			);
			if (this.disposed || abortController.signal.aborted || sequence !== this.loadSequence) return;

			this.visible = visible;
			this.lastDataZoom = z;
			this.render();
		} catch (error) {
			if (abortController.signal.aborted) return;
			coverageError("tencent", `visible coverage load failed: ${errorText(error)}`, error);
		}
	}

	getDebugState() {
		return {
			active: this.prefs.active,
			features: this.visible.reduce((sum, tile) => sum + tile.decoded.sv + tile.decoded.ccf, 0),
			dataZoom: this.lastDataZoom,
		};
	}

	destroy() {
		if (this.disposed) return;
		this.disposed = true;
		this.abortController?.abort();
		this.tileCache.clear();
		this.map.removeControl(this.overlay);
	}

	private getCachedTile(key: string): DecodedTile | undefined {
		const cached = this.tileCache.get(key);
		if (!cached) return undefined;
		this.tileCache.delete(key);
		this.tileCache.set(key, cached);
		return cached;
	}

	private cacheTile(key: string, tile: DecodedTile) {
		this.tileCache.set(key, tile);
		while (this.tileCache.size > TILE_CACHE_SIZE) {
			const oldest = this.tileCache.keys().next().value;
			if (oldest === undefined) break;
			this.tileCache.delete(oldest);
		}
	}

	private async decodeTile(tile: TileCoordinate, signal: AbortSignal): Promise<DecodedTile> {
		const result = await this.archive.getZxy(tile.z, tile.x, tile.y, signal);
		if (!result) {
			return { data: { type: "FeatureCollection", features: [] }, sv: 0, ccf: 0 };
		}
		const vectorTile = new VectorTile(new PbfReader(result.data));
		const features: Feature<Geometry>[] = [];
		let sv = 0;
		let ccf = 0;
		for (const sourceLayer of ["sv", "ccf"] as const) {
			const layer = vectorTile.layers[sourceLayer];
			if (!layer) continue;
			if (sourceLayer === "sv") sv += layer.length;
			else ccf += layer.length;
			for (let index = 0; index < layer.length; index++) {
				const feature = layer.feature(index).toGeoJSON(tile.x, tile.y, tile.z);
				feature.properties = { ...feature.properties, qqLayer: sourceLayer };
				features.push(feature as Feature<Geometry>);
			}
		}
		return { data: { type: "FeatureCollection", features }, sv, ccf };
	}

	private render() {
		if (this.visible.length === 0 || !this.prefs.active || this.prefs.opacity <= 0) return;
		const displayZoom = this.map.getZoom() + this.displayZoomOffset;
		const casingWidth = this.prefs.thin ? 1 : displayZoom <= 5 ? 5 : 3;
		const lineWidth = this.prefs.thin ? 0.5 : 1;
		const casingLayers = this.visible.map(
			(tile) =>
				new GeoJsonLayer({
					id: `mma-cn-tencent-coverage-casing-${tile.key}`,
					data: tile.decoded.data,
					pickable: false,
					filled: false,
					stroked: true,
					lineWidthUnits: "pixels",
					getLineWidth: casingWidth,
					getLineColor: CASING_COLOR,
					opacity: this.prefs.opacity * 0.9,
					lineCapRounded: true,
					lineJointRounded: true,
				}),
		);
		const mainLayers = this.visible.map(
			(tile) =>
				new GeoJsonLayer({
					id: `mma-cn-tencent-coverage-main-${tile.key}`,
					data: tile.decoded.data,
					pickable: false,
					filled: false,
					stroked: true,
					lineWidthUnits: "pixels",
					getLineWidth: lineWidth,
					getLineColor: this.lineColor,
					opacity: this.prefs.opacity,
					lineCapRounded: true,
					lineJointRounded: true,
				}),
		);
		this.overlay.setProps({ layers: [...casingLayers, ...mainLayers] });
	}

	private clearVisible() {
		this.loadSequence++;
		this.abortController?.abort();
		this.abortController = null;
		this.visible = [];
		this.lastDataZoom = null;
		this.overlay.setProps({ layers: [] });
	}
}
