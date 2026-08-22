import type { AddProtocolAction } from "maplibre-gl";
import { gcj02ToBd09Mc } from "@/lib/pano/coords";

const TILE_SIZE = 256;
const MAX_SOURCE_REQUESTS = 12;
const CHINA_BOUNDS = { west: 72.004, south: 0.8293, east: 137.8347, north: 55.8271 };

type XY = [number, number];

let activeSourceRequests = 0;
const sourceRequestWaiters: Array<() => void> = [];

async function withSourceRequestSlot<T>(task: () => Promise<T>): Promise<T> {
	if (activeSourceRequests >= MAX_SOURCE_REQUESTS) {
		await new Promise<void>((resolve) => sourceRequestWaiters.push(resolve));
	}
	activeSourceRequests++;
	try {
		return await task();
	} finally {
		activeSourceRequests--;
		sourceRequestWaiters.shift()?.();
	}
}

function inverseWebMercator([x, y]: XY, zoom: number): XY {
	const world = TILE_SIZE * 2 ** zoom;
	const lng = (x / world) * 360 - 180;
	const mercatorY = Math.PI * (1 - (2 * y) / world);
	const lat = (Math.atan(Math.sinh(mercatorY)) * 180) / Math.PI;
	return [lng, lat];
}

export function baiduCoverageTileIntersectsChina(x: number, y: number, zoom: number): boolean {
	const tileCount = 2 ** zoom;
	const canonicalX = ((x % tileCount) + tileCount) % tileCount;
	const [west, north] = inverseWebMercator([canonicalX * TILE_SIZE, y * TILE_SIZE], zoom);
	const [east, south] = inverseWebMercator(
		[(canonicalX + 1) * TILE_SIZE, (y + 1) * TILE_SIZE],
		zoom,
	);
	return !(
		east < CHINA_BOUNDS.west ||
		west > CHINA_BOUNDS.east ||
		north < CHINA_BOUNDS.south ||
		south > CHINA_BOUNDS.north
	);
}

function baiduMcToTile([x, y]: XY, zoom: number): XY {
	const dpi = 2 ** (18 - zoom);
	return [x / dpi / TILE_SIZE, y / dpi / TILE_SIZE];
}

async function bitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
	return withSourceRequestSlot(async () => {
		let lastError: unknown;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const response = await fetch(url, { signal, cache: "force-cache" });
				if (!response.ok) {
					throw new Error(`Baidu coverage tile returned HTTP ${response.status}`);
				}
				return await createImageBitmap(await response.blob());
			} catch (error) {
				if (signal.aborted) throw error;
				lastError = error;
			}
		}
		throw lastError;
	});
}

async function transparentTile(): Promise<ImageBitmap> {
	return createImageBitmap(new OffscreenCanvas(TILE_SIZE, TILE_SIZE));
}

async function renderBaiduCoverageTile(
	x: number,
	y: number,
	z: number,
	signal: AbortSignal,
): Promise<ImageBitmap> {
	if (!baiduCoverageTileIntersectsChina(x, y, z)) return transparentTile();
	const tileCount = 2 ** z;
	const canonicalX = ((x % tileCount) + tileCount) % tileCount;
	const topLeft = inverseWebMercator([canonicalX * TILE_SIZE, y * TILE_SIZE], z);
	const bottomRight = inverseWebMercator([(canonicalX + 1) * TILE_SIZE, (y + 1) * TILE_SIZE], z);

	// Baidu's road/coverage tiles start at z=3. Reuse that level for the
	// world-scale MapLibre tiles so coverage remains visible while zoomed out.
	const baiduZoom = Math.max(3, z + 1);
	const topLeftTile = baiduMcToTile(gcj02ToBd09Mc({ lng: topLeft[0], lat: topLeft[1] }), baiduZoom);
	const bottomRightTile = baiduMcToTile(
		gcj02ToBd09Mc({ lng: bottomRight[0], lat: bottomRight[1] }),
		baiduZoom,
	);
	const minX = Math.floor(topLeftTile[0]);
	const maxX = Math.floor(bottomRightTile[0]);
	const maxY = Math.floor(topLeftTile[1]);
	const minY = Math.floor(bottomRightTile[1]);
	const cols = maxX - minX + 1;
	const rows = maxY - minY + 1;
	if (cols <= 0 || rows <= 0 || cols > 8 || rows > 8) {
		throw new Error(`Unexpected Baidu coverage crop ${cols}x${rows} at z${z}`);
	}

	const helper = new OffscreenCanvas(TILE_SIZE * cols, TILE_SIZE * rows);
	const helperContext = helper.getContext("2d");
	if (!helperContext) throw new Error("2D canvas is unavailable");
	const images = await Promise.all(
		Array.from({ length: cols * rows }, async (_, index) => {
			const tileX = minX + (index % cols);
			const tileY = maxY - Math.floor(index / cols);
			const server = Math.abs(tileX % 2);
			try {
				const image = await bitmap(
					`https://mapsv${server}.bdimg.com/tile/?udt=20200825&qt=tile&styles=pl&x=${tileX}&y=${tileY}&z=${baiduZoom}`,
					signal,
				);
				return { image, tileX, tileY };
			} catch (error) {
				if (signal.aborted) throw error;
				return null;
			}
		}),
	);
	for (const loaded of images) {
		if (!loaded) continue;
		helperContext.drawImage(
			loaded.image,
			(loaded.tileX - minX) * TILE_SIZE,
			(maxY - loaded.tileY) * TILE_SIZE,
		);
		loaded.image.close();
	}
	if (!images.some(Boolean)) throw new Error("All Baidu coverage source tiles failed to load");

	const sourceX = (topLeftTile[0] - minX) * TILE_SIZE;
	const sourceY = (maxY + 1 - topLeftTile[1]) * TILE_SIZE;
	const sourceWidth = (bottomRightTile[0] - topLeftTile[0]) * TILE_SIZE;
	const sourceHeight = (topLeftTile[1] - bottomRightTile[1]) * TILE_SIZE;
	const output = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
	const outputContext = output.getContext("2d");
	if (!outputContext) throw new Error("2D canvas is unavailable");
	outputContext.drawImage(
		helper,
		sourceX,
		sourceY,
		sourceWidth,
		sourceHeight,
		0,
		0,
		TILE_SIZE,
		TILE_SIZE,
	);
	return output.transferToImageBitmap();
}

export const baiduCoverageProtocol: AddProtocolAction = async (params, abortController) => {
	const match = params.url.match(/^mma-baidu:\/\/tiles\/(-?\d+)\/(-?\d+)\/(-?\d+)/);
	if (!match) throw new Error(`Invalid Baidu coverage URL: ${params.url}`);
	const [, z, x, y] = match.map(Number);
	return { data: await renderBaiduCoverageTile(x, y, z, abortController.signal) };
};
