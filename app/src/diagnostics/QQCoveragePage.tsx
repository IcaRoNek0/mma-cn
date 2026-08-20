import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { VectorTile } from "@mapbox/vector-tile";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { GeoJsonLayer } from "@deck.gl/layers";
import { PbfReader } from "pbf";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import "@/diagnostics/qqCoverage.css";
import { petalTileUrl } from "@/lib/map/chinaBasemap";
import { bundledTencentCoverage } from "@/lib/map/tencentCoverage";

const CENTER: [number, number] = [114.92, 27.825];

type LogEntry = {
	time: string;
	message: string;
	data?: unknown;
};

type TileCoordinate = {
	z: number;
	x: number;
	y: number;
};

function tileAt(lng: number, lat: number, z: number): TileCoordinate {
	const scale = 2 ** z;
	return {
		z,
		x: Math.floor(((lng + 180) / 360) * scale),
		y: Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * scale),
	};
}

function visibleTiles(map: maplibregl.Map, z: number): TileCoordinate[] {
	const bounds = map.getBounds();
	const northWest = tileAt(bounds.getWest(), bounds.getNorth(), z);
	const southEast = tileAt(bounds.getEast(), bounds.getSouth(), z);
	const maximum = 2 ** z - 1;
	// Keep one tile outside the viewport so clipped line ends are already present
	// while panning and around the visible tile boundary.
	const minX = Math.max(0, Math.min(maximum, northWest.x - 1));
	const maxX = Math.max(0, Math.min(maximum, southEast.x + 1));
	const minY = Math.max(0, Math.min(maximum, northWest.y - 1));
	const maxY = Math.max(0, Math.min(maximum, southEast.y + 1));
	const tiles: TileCoordinate[] = [];
	for (let x = minX; x <= maxX; x++) {
		for (let y = minY; y <= maxY; y++) tiles.push({ z, x, y });
	}
	return tiles;
}

function errorText(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function QQCoveragePage() {
	const mapContainer = useRef<HTMLDivElement>(null);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [status, setStatus] = useState("initializing");
	const [tileStats, setTileStats] = useState("sv=0, ccf=0");

	useEffect(() => {
		const container = mapContainer.current;
		if (!container) return;
		let disposed = false;
		let loadSequence = 0;
		let loadAbort: AbortController | null = null;
		const archive = bundledTencentCoverage();
		const append = (message: string, data?: unknown) => {
			if (disposed) return;
			const entry = { time: new Date().toLocaleTimeString(), message, data };
			setLogs((current) => [...current.slice(-79), entry]);
			// Keep the same evidence available in browser developer tools.
			// eslint-disable-next-line no-console
			console.info(`[qqcoverage] ${message}`, data ?? "");
		};

		const map = new maplibregl.Map({
			container,
			style: {
				version: 8,
				sources: {
					petal: {
						type: "raster",
						tiles: [petalTileUrl()],
						tileSize: 256,
						maxzoom: 19,
					},
				},
				layers: [
					{ id: "background", type: "background", paint: { "background-color": "#e9e6dc" } },
					{
						id: "petal",
						type: "raster",
						source: "petal",
						paint: { "raster-fade-duration": 0 },
					},
				],
			},
			center: CENTER,
			zoom: 9,
			minZoom: 2,
			maxZoom: 17.4,
			maxPitch: 0,
			dragRotate: false,
			pitchWithRotate: false,
			attributionControl: false,
			fadeDuration: 0,
		});
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
		const coverageOverlay = new MapboxOverlay({
			interleaved: false,
			layers: [],
			onError: (error) => append("deck.gl error", errorText(error)),
		});
		map.addControl(coverageOverlay);

		const loadVisibleCoverage = async () => {
			const sequence = ++loadSequence;
			loadAbort?.abort();
			const abortController = new AbortController();
			loadAbort = abortController;
			// Match the review plugin's maxDataZoom so higher zooms reuse stable z11 data.
			const z = Math.min(11, Math.max(0, Math.floor(map.getZoom())));
			const tiles = visibleTiles(map, z);
			setStatus(`loading ${tiles.length} PMTiles tiles at z${z}`);
			append("visible coverage load started", { z, tiles });

			try {
				const decoded = await Promise.all(
					tiles.map(async (tile) => {
						const result = await archive.getZxy(tile.z, tile.x, tile.y, abortController.signal);
						if (!result) return { features: [] as Feature<Geometry>[], sv: 0, ccf: 0 };
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
						append("PMTiles tile decoded", {
							...tile,
							bytes: result.data.byteLength,
							sv,
							ccf,
						});
						return { features, sv, ccf };
					}),
				);
				if (disposed || abortController.signal.aborted || sequence !== loadSequence) return;

				const features = decoded.flatMap((tile) => tile.features);
				const sv = decoded.reduce((sum, tile) => sum + tile.sv, 0);
				const ccf = decoded.reduce((sum, tile) => sum + tile.ccf, 0);
				const data: FeatureCollection = { type: "FeatureCollection", features };
				coverageOverlay.setProps({
					layers: [
						new GeoJsonLayer({
							id: `qqcoverage-casing-${sequence}`,
							data,
							pickable: false,
							filled: false,
							stroked: true,
							lineWidthUnits: "pixels",
							getLineWidth: map.getZoom() <= 5 ? 5 : 3,
							getLineColor: [186, 200, 255, 255],
							lineCapRounded: true,
							lineJointRounded: true,
						}),
						new GeoJsonLayer({
							id: `qqcoverage-main-${sequence}`,
							data,
							pickable: false,
							filled: false,
							stroked: true,
							lineWidthUnits: "pixels",
							getLineWidth: 1,
							getLineColor: [66, 99, 235, 255],
							lineCapRounded: true,
							lineJointRounded: true,
						}),
					],
				});
				setTileStats(`sv=${sv}, ccf=${ccf}`);
				setStatus(`deck.gl rendered ${features.length} features from ${tiles.length} tiles`);
				append("deck.gl coverage submitted", {
					z,
					tiles: tiles.length,
					features: features.length,
					sv,
					ccf,
				});
			} catch (error) {
				if (abortController.signal.aborted) {
					append("visible coverage load superseded");
					return;
				}
				append("visible coverage load failed", errorText(error));
				setStatus("coverage load failed");
			}
		};

		map.on("error", (event) => {
			append("MapLibre error", errorText(event.error));
			setStatus("error");
		});

		map.on("load", async () => {
			append("Huawei basemap loaded");
			setStatus("probing local PMTiles");
			try {
				const header = await archive.getHeader();
				append("PMTiles header loaded", {
					specVersion: header.specVersion,
					minZoom: header.minZoom,
					maxZoom: header.maxZoom,
					tileType: header.tileType,
					bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
				});
			} catch (error) {
				append("direct PMTiles probe failed", errorText(error));
				setStatus("PMTiles probe failed");
				return;
			}
			if (disposed) return;

			append("deck.gl coverage overlay added");
			map.on("moveend", loadVisibleCoverage);
			await loadVisibleCoverage();
		});

		return () => {
			disposed = true;
			loadAbort?.abort();
			map.removeControl(coverageOverlay);
			map.remove();
		};
	}, []);

	return (
		<div className="qqcoverage-page">
			<div ref={mapContainer} className="qqcoverage-map" />
			<header className="qqcoverage-header">
				<div>
					<strong>QQ Coverage Lab</strong>
					<span>Huawei + deck.gl decoded Tencent PMTiles</span>
				</div>
				<a href="/">Return to MMA</a>
			</header>
			<section className="qqcoverage-status">
				<div>
					<span>Status</span>
					<b>{status}</b>
				</div>
				<div>
					<span>Decoded features</span>
					<b>{tileStats}</b>
				</div>
				<div>
					<span>Center</span>
					<b>
						{CENTER[0]}, {CENTER[1]}
					</b>
				</div>
			</section>
			<aside className="qqcoverage-log">
				<h2>Live trace</h2>
				{logs.length === 0 && <p>Waiting for initialization...</p>}
				{logs.map((entry, index) => (
					<div className="qqcoverage-log-row" key={`${entry.time}-${index}`}>
						<time>{entry.time}</time>
						<span>{entry.message}</span>
						{entry.data !== undefined && <code>{JSON.stringify(entry.data)}</code>}
					</div>
				))}
			</aside>
		</div>
	);
}
