import { TileConfig, LayerType, buildSvCoverageConfig, buildTileUrl } from "@/lib/geo/tiles";
import { latLngToWorld, worldToTile, pixelToLatLng, TILE_SIZE } from "@/lib/geo/mercator";
import { cmd } from "@/lib/commands";
import { log } from "@/lib/util/log";
import { chunk, shuffle } from "@/lib/util/util";
import { streamedPoints } from "./pointSources";
import type { PointSource } from "./types";
import type { PolygonGeometry } from "@/bindings.gen";
import type { Bounds, LatLng } from "@/types";

const CLIP_BATCH = 50_000;

const MAX_TILES_PER_AXIS = 150;
/** The axis cap whose zoom sets the point-density baseline that `keepRate` thins to. */
const BASE_TILES_PER_AXIS = 50;
const FETCH_CONCURRENCY = 24;
const SCAN_YIELD_EVERY = 6;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const EARTH_RADIUS_M = 6_371_008.8;
const PIXEL_KEY_SCALE = 2 ** 24;

/** Finer tiles put the jittered probe on the road instead of somewhere in a coarse
 *  pixel's cell; thinning each pixel back to the base zoom's line density keeps the
 *  point supply, memory and clip cost where they were. */
export function keepRate(zoom: number, baseZoom: number): number {
	return Math.min(1, 2 ** (baseZoom - zoom));
}

const CELL_PX = 32;
const EVEN_CELL_POINTS = 600 * (CELL_PX / TILE_SIZE) ** 2;

/** Probes per area the `distribution` setting buys, from road-density-proportional to
 *  a flat share per cell. */
export const DISTRIBUTION_EVENNESS = { density: 0, balanced: 0.5, even: 1 } as const;

/** A cell's pixel keep-probability: density keeps `globalKeep` everywhere, even aims
 *  at a flat point count per cell, and `evenness` blends between them. */
export function cellKeepRate(rawCount: number, globalKeep: number, evenness: number): number {
	if (rawCount === 0) return 0;
	const even = Math.min(1, EVEN_CELL_POINTS / rawCount);
	return (1 - evenness) * globalKeep + evenness * even;
}

/** Thins scanned pixels cell by cell, so a flat share holds inside a tile instead of one
 *  dense corner absorbing it, and no lone road hoards a whole tile's quota. */
export function thinCells(
	xs: number[],
	ys: number[],
	from: number,
	globalKeep: number,
	evenness: number,
) {
	if (evenness === 0 && globalKeep >= 1) return;
	const cellOf = (i: number) => ((xs[i] / CELL_PX) | 0) * 2 ** 20 + ((ys[i] / CELL_PX) | 0);
	const counts = new Map<number, number>();
	for (let i = from; i < xs.length; i++) {
		const c = cellOf(i);
		counts.set(c, (counts.get(c) ?? 0) + 1);
	}
	let w = from;
	for (let i = from; i < xs.length; i++) {
		if (Math.random() < cellKeepRate(counts.get(cellOf(i))!, globalKeep, evenness)) {
			xs[w] = xs[i];
			ys[w] = ys[i];
			w++;
		}
	}
	xs.length = w;
	ys.length = w;
}

export function spacedFilter(spacingMeters: number): (points: LatLng[]) => LatLng[] {
	const cells = new Map<string, { x: number; y: number; z: number }[]>();
	return (points) => {
		const kept: LatLng[] = [];
		for (const point of points) {
			const lat = (point.lat * Math.PI) / 180;
			const lng = (point.lng * Math.PI) / 180;
			const scale = EARTH_RADIUS_M / spacingMeters;
			const cosLat = Math.cos(lat);
			const x = scale * cosLat * Math.cos(lng);
			const y = scale * cosLat * Math.sin(lng);
			const z = scale * Math.sin(lat);
			const cx = Math.floor(x);
			const cy = Math.floor(y);
			const cz = Math.floor(z);
			let clear = true;
			for (let dx = -1; dx <= 1 && clear; dx++) {
				for (let dy = -1; dy <= 1 && clear; dy++) {
					for (let dz = -1; dz <= 1 && clear; dz++) {
						const bucket = cells.get(`${cx + dx}:${cy + dy}:${cz + dz}`);
						if (!bucket) continue;
						clear = bucket.every((other) => {
							const ox = x - other.x;
							const oy = y - other.y;
							const oz = z - other.z;
							return ox * ox + oy * oy + oz * oz >= 1;
						});
					}
				}
			}
			if (!clear) continue;
			const key = `${cx}:${cy}:${cz}`;
			let bucket = cells.get(key);
			if (!bucket) cells.set(key, (bucket = []));
			bucket.push({ x, y, z });
			kept.push(point);
		}
		return kept;
	};
}

/** Columns run east from the northwest tile, wrapping the world, so a region crossing
 *  the antimeridian counts forward instead of coming out negative and scanning nothing. */
function tileCols(nwX: number, seX: number, zoom: number): number {
	const perAxis = 2 ** zoom;
	return ((seX - nwX + perAxis) % perAxis) + 1;
}

function tilePlanAt(b: Bounds, zoom: number) {
	const nwWorld = latLngToWorld({ lat: b.north, lng: b.west });
	const seWorld = latLngToWorld({ lat: b.south, lng: b.east });
	const nw = worldToTile(nwWorld.x, nwWorld.y, zoom);
	const se = worldToTile(seWorld.x, seWorld.y, zoom);
	return { zoom, nwTile: nw, seTile: se, cols: tileCols(nw.x, se.x, zoom), rows: se.y - nw.y + 1 };
}

export function calculateZoom(b: Bounds, maxPerAxis: number) {
	for (let zoom = 16; zoom >= 0; zoom--) {
		const plan = tilePlanAt(b, zoom);
		if (plan.cols <= maxPerAxis && plan.rows <= maxPerAxis) return plan;
	}
	return tilePlanAt(b, 0);
}

export function spacedZoom(b: Bounds, spacingMeters: number, maxZoom: number): number {
	if (!Number.isFinite(spacingMeters) || spacingMeters <= 0)
		throw new RangeError("Invalid spacing");
	const midLat = (((b.north + b.south) / 2) * Math.PI) / 180;
	const zoom = Math.ceil(
		Math.log2((EARTH_CIRCUMFERENCE_M * Math.cos(midLat)) / (TILE_SIZE * (spacingMeters / 16))),
	);
	return Math.min(Math.max(zoom, 0), maxZoom);
}

export function sampleGridlines(
	pixels: Set<number>,
	zoom: number,
	spacing: number,
	suppress: (points: LatLng[]) => LatLng[] = spacedFilter(spacing * 0.8),
): LatLng[] {
	const points: LatLng[] = [];
	for (const key of pixels) {
		const x = Math.floor(key / PIXEL_KEY_SCALE);
		const y = key % PIXEL_KEY_SCALE;
		const point = pixelToLatLng(x + 0.5, y + 0.5, zoom);
		const lat = (point.lat * Math.PI) / 180;
		const metersPerPixel = (EARTH_CIRCUMFERENCE_M * Math.cos(lat)) / (2 ** zoom * TILE_SIZE);
		const northing = EARTH_RADIUS_M * lat;
		const easting = EARTH_RADIUS_M * ((point.lng * Math.PI) / 180) * Math.cos(lat);
		const rowOffset = Math.abs(northing - Math.round(northing / spacing) * spacing);
		const columnOffset = Math.abs(easting - Math.round(easting / spacing) * spacing);
		if (rowOffset > metersPerPixel / 2 && columnOffset > metersPerPixel / 2) continue;
		if (suppress([point]).length > 0) points.push(point);
	}
	return points;
}

function buildSamplerTileConfig(): TileConfig {
	const { cc, svl, mapStyles } = buildSvCoverageConfig({
		showOfficial: true,
		showUnofficial: true,
		styles: [{ stylers: [{ color: "#ffffff" }] }],
		useDetailedLines: true,
	});
	return new TileConfig({
		query: { tile: {} },
		layers: [
			{
				type: LayerType.STREETVIEW,
				layerName: "svv",
				layerOptions: [
					{ key: "cc", value: cc },
					{ key: "svl", value: svl },
				],
			},
		],
		options: { language: "en", region: "US", styles: mapStyles },
		renderOptions: { scale: 1 },
	});
}

async function fetchTileBlob(
	cfg: TileConfig,
	tileX: number,
	tileY: number,
	zoom: number,
	signal: AbortSignal,
): Promise<ImageBitmap | null> {
	const url = buildTileUrl(cfg, tileX, tileY, zoom);
	try {
		const resp = await fetch(url, { signal });
		if (!resp.ok) return null;
		return await createImageBitmap(await resp.blob());
	} catch {
		return null;
	}
}

function scanTile(
	bmp: ImageBitmap,
	tileX: number,
	tileY: number,
	ctx: OffscreenCanvasRenderingContext2D,
	pixelXs: number[],
	pixelYs: number[],
) {
	ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
	ctx.drawImage(bmp, 0, 0);
	bmp.close();
	const { data } = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
	const baseX = tileX * TILE_SIZE;
	const baseY = tileY * TILE_SIZE;
	for (let py = 0; py < TILE_SIZE; py++) {
		for (let px = 0; px < TILE_SIZE; px++) {
			if (data[(py * TILE_SIZE + px) * 4 + 3] > 0) {
				pixelXs.push(baseX + px);
				pixelYs.push(baseY + py);
			}
		}
	}
}

async function clipToPolygon(
	polygon: PolygonGeometry,
	candidates: LatLng[],
	signal: AbortSignal,
): Promise<LatLng[]> {
	const result: LatLng[] = [];
	for (const batch of chunk(candidates, CLIP_BATCH)) {
		if (signal.aborted) return result;
		// eslint-disable-next-line local/no-ipc-in-loop -- already bulk: 50k points per round trip
		const inside = await cmd.polygonContainsPoints(
			polygon,
			batch.map((p) => p.lat),
			batch.map((p) => p.lng),
		);
		for (let i = 0; i < batch.length; i++) if (inside[i]) result.push(batch[i]);
	}
	return result;
}

/** Tiles land in random order and each scanned batch is released as soon as it is clipped,
 *  so probing starts on the first tiles while the rest are still downloading. Two passes:
 *  a coarse one covers the whole region in seconds, so a run that stops early still probed
 *  everywhere, then the fine pass replaces each tile's coarse points as it lands. */
export function blueLineSource(
	polygon: PolygonGeometry,
	plan: { type: "allocation"; evenness: number } | { type: "spacing"; spacing: number } = {
		type: "allocation",
		evenness: 0,
	},
	maxTilesPerAxis = MAX_TILES_PER_AXIS,
): PointSource {
	return streamedPoints(async (emit, retire, signal, reportProgress) => {
		const box = await cmd.polygonBounds(polygon);
		if (!box || signal.aborted) return;
		const bounds: Bounds = { west: box[0], south: box[1], east: box[2], north: box[3] };
		if (plan.type === "spacing") {
			await spacedRun(polygon, bounds, plan.spacing, maxTilesPerAxis, emit, signal, reportProgress);
			return;
		}
		const fine = calculateZoom(bounds, maxTilesPerAxis);
		const coarse = calculateZoom(bounds, BASE_TILES_PER_AXIS);
		const keep = keepRate(fine.zoom, coarse.zoom);
		const evenness = plan.evenness;
		const finePerAxis = 2 ** fine.zoom;
		const fineKey = (p: LatLng) => {
			const w = latLngToWorld(p);
			const t = worldToTile(w.x, w.y, fine.zoom);
			return t.y * finePerAxis + t.x;
		};
		log.info(
			`[generator] Blue line: ${fine.cols * fine.rows} tiles (${fine.cols}x${fine.rows}) at zoom ${fine.zoom}, keeping ${Math.round(keep * 100)}% of pixels`,
		);

		const cfg = buildSamplerTileConfig();
		const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
		const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

		let total = 0;
		let completedTiles = 0;
		const totalTiles =
			fine.cols * fine.rows + (fine.zoom > coarse.zoom ? coarse.cols * coarse.rows : 0);
		const pass = async (
			plan: ReturnType<typeof calculateZoom>,
			globalKeep: number,
			deliver: (points: LatLng[], scanned: { tx: number; ty: number }[]) => void,
		) => {
			const tileJobs: { tx: number; ty: number }[] = [];
			const perAxis = 2 ** plan.zoom;
			for (let ty = plan.nwTile.y; ty <= plan.seTile.y; ty++) {
				for (let c = 0; c < plan.cols; c++) {
					tileJobs.push({ tx: (plan.nwTile.x + c) % perAxis, ty });
				}
			}
			shuffle(tileJobs);

			// Fetch tiles concurrently, scan pixels sequentially (canvas is shared)
			for (const batch of chunk(tileJobs, FETCH_CONCURRENCY)) {
				if (signal.aborted) return;
				const bmps = await Promise.all(
					batch.map((j) => fetchTileBlob(cfg, j.tx, j.ty, plan.zoom, signal)),
				);
				if (signal.aborted) {
					for (const bitmap of bmps) bitmap?.close();
					return;
				}
				const pixelXs: number[] = [];
				const pixelYs: number[] = [];
				const scanned: { tx: number; ty: number }[] = [];
				for (let b = 0; b < batch.length; b++) {
					const bmp = bmps[b];
					if (!bmp) continue;
					scanned.push(batch[b]);
					const start = pixelXs.length;
					scanTile(bmp, batch[b].tx, batch[b].ty, ctx, pixelXs, pixelYs);
					thinCells(pixelXs, pixelYs, start, globalKeep, evenness);
					if (b % SCAN_YIELD_EVERY === SCAN_YIELD_EVERY - 1) {
						await new Promise((resolve) => setTimeout(resolve));
					}
				}
				const candidates: LatLng[] = new Array(pixelXs.length);
				for (let i = 0; i < pixelXs.length; i++) {
					candidates[i] = pixelToLatLng(
						pixelXs[i] + Math.random(),
						pixelYs[i] + Math.random(),
						plan.zoom,
					);
				}
				const points =
					candidates.length > 0 ? await clipToPolygon(polygon, candidates, signal) : [];
				total += points.length;
				deliver(points, scanned);
				completedTiles += batch.length;
				reportProgress(completedTiles / totalTiles);
			}
		};

		if (fine.zoom > coarse.zoom) {
			await pass(coarse, keepRate(coarse.zoom, coarse.zoom), (points) => {
				const byKey = new Map<number, LatLng[]>();
				for (const p of points) {
					const k = fineKey(p);
					let group = byKey.get(k);
					if (!group) byKey.set(k, (group = []));
					group.push(p);
				}
				for (const [k, group] of byKey) emit(group, k);
			});
		}
		// A fine tile that failed to fetch is not scanned, so its coarse points stay.
		await pass(fine, keep, (points, scanned) => {
			if (fine.zoom > coarse.zoom) {
				for (const t of scanned) retire(t.ty * finePerAxis + t.tx);
			}
			if (points.length > 0) emit(points);
		});

		log.info(`[generator] Blue line: ${total} sample points after polygon clip`);
	});
}

async function spacedRun(
	polygon: PolygonGeometry,
	bounds: Bounds,
	spacing: number,
	maxTilesPerAxis: number,
	emit: (points: LatLng[]) => void,
	signal: AbortSignal,
	reportProgress: (fraction: number) => void,
): Promise<void> {
	const zoom = spacedZoom(bounds, spacing, calculateZoom(bounds, maxTilesPerAxis).zoom);
	const plan = tilePlanAt(bounds, zoom);
	log.info(
		`[generator] Blue line spacing: ${plan.cols * plan.rows} tiles (${plan.cols}x${plan.rows}) at zoom ${zoom}, pitch ${spacing}m`,
	);
	const cfg = buildSamplerTileConfig();
	const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
	const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
	const suppress = spacedFilter(spacing * 0.8);
	const perAxis = 2 ** zoom;
	const tileJobs: { tx: number; ty: number }[] = [];
	for (let ty = plan.nwTile.y; ty <= plan.seTile.y; ty++) {
		for (let col = 0; col < plan.cols; col++) {
			tileJobs.push({ tx: (plan.nwTile.x + col) % perAxis, ty });
		}
	}
	shuffle(tileJobs);
	let total = 0;
	let completed = 0;
	for (const batch of chunk(tileJobs, FETCH_CONCURRENCY)) {
		if (signal.aborted) return;
		const bitmaps = await Promise.all(
			batch.map((job) => fetchTileBlob(cfg, job.tx, job.ty, zoom, signal)),
		);
		if (signal.aborted) {
			for (const bitmap of bitmaps) bitmap?.close();
			return;
		}
		if (bitmaps.some((bitmap) => !bitmap)) {
			for (const bitmap of bitmaps) bitmap?.close();
			throw new Error("Coverage tiles could not be loaded for the complete spacing plan");
		}
		const xs: number[] = [];
		const ys: number[] = [];
		for (let index = 0; index < batch.length; index++) {
			scanTile(bitmaps[index]!, batch[index].tx, batch[index].ty, ctx, xs, ys);
			if (index % SCAN_YIELD_EVERY === SCAN_YIELD_EVERY - 1) {
				await new Promise((resolve) => setTimeout(resolve));
			}
		}
		const pixels = new Set<number>();
		for (let index = 0; index < xs.length; index++) {
			pixels.add(xs[index] * PIXEL_KEY_SCALE + ys[index]);
		}
		const sampled = sampleGridlines(pixels, zoom, spacing, suppress);
		const points = sampled.length > 0 ? await clipToPolygon(polygon, sampled, signal) : [];
		total += points.length;
		if (points.length > 0) emit(points);
		completed += batch.length;
		reportProgress(completed / tileJobs.length);
	}
	log.info(`[generator] Blue line spacing: ${total} probes after polygon clip`);
}
