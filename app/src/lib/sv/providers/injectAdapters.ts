import { parsePanoDate, type PanoramaMetadata, type PanoSource } from "@/lib/pano";
import { getPanoramaProvider } from "@/lib/pano";
import { BAIDU_VIEWER_PREFIX, TENCENT_VIEWER_PREFIX, stripViewerPanoId } from "@/lib/sv/openSvIds";

const RPC_OK = 0;
const IMAGE_OK = 1;
const OFFICIAL = 2;
const PHOTOSPHERE = 2;

type AdapterId = "baidu" | "tencent";
export interface InjectAdapter {
	id: AdapterId;
	legacyPbMarker: RegExp;
	legacyIdPattern: RegExp;
	isPanoId(id: string): boolean;
	idsFromGetMetadata(body: unknown): string[] | null;
	handleGetMetadata(ids: string[]): Promise<unknown>;
	handleLegacyGetMetadata(ids: string[]): Promise<unknown | null>;
	rewriteTile(panoId: string, zoom: number, x: number, y: number): string | null;
}

const metadataCache = new Map<string, PanoramaMetadata>();

function isPrefixed(id: unknown, prefix: string): id is string {
	return typeof id === "string" && id.startsWith(prefix) && id.length > prefix.length;
}

function idsFromRequest(body: unknown, prefix: string): string[] | null {
	if (!Array.isArray(body) || !Array.isArray(body[2]) || body[2].length === 0) return null;
	const ids: string[] = [];
	for (const query of body[2]) {
		const id = Array.isArray(query) && Array.isArray(query[0]) ? query[0][1] : null;
		if (!isPrefixed(id, prefix)) return null;
		ids.push(id);
	}
	return ids;
}

function size(width: number, height: number): unknown[] {
	const out: unknown[] = [];
	out[0] = height;
	out[1] = width;
	return out;
}

function imageKey(id: string): unknown[] {
	return [OFFICIAL, id];
}

function latLng(lat: number, lng: number): unknown[] {
	const out: unknown[] = [];
	out[2] = lat;
	out[3] = lng;
	return out;
}

function imageLocation(ll: unknown[], heading: number): unknown[] {
	const out: unknown[] = [];
	out[0] = ll;
	out[2] = [heading];
	out[4] = "CN";
	return out;
}

function linked(key: unknown[], location: unknown[]): unknown[] {
	const out: unknown[] = [];
	out[0] = key;
	out[2] = location;
	return out;
}

function metadataPayload(meta: PanoramaMetadata, prefix: string): unknown[] {
	const panoId = `${prefix}${meta.panoId}`;
	const panoramas: unknown[] = [];
	const links: unknown[] = [];
	const times: unknown[] = [];
	const index = new Map<string, number>();
	for (const link of meta.links) {
		if (!link.panoId || index.has(link.panoId)) continue;
		index.set(link.panoId, panoramas.length);
		panoramas.push(
			linked(
				imageKey(`${prefix}${link.panoId}`),
				imageLocation(latLng(meta.position.lat, meta.position.lng), link.heading ?? 0),
			),
		);
	}
	for (const link of meta.links) {
		const i = index.get(link.panoId);
		if (i != null) links.push([i, [, , , link.heading ?? 0]]);
	}
	for (const version of meta.timeline) {
		const i = panoramas.length;
		panoramas.push(
			linked(
				imageKey(`${prefix}${version.panoId}`),
				imageLocation(latLng(meta.position.lat, meta.position.lng), meta.heading),
			),
		);
		times.push([
			i,
			[version.date.getFullYear(), version.date.getMonth() + 1, version.date.getDate()],
		]);
	}

	const tiles: unknown[] = [];
	tiles[0] = OFFICIAL;
	tiles[1] = PHOTOSPHERE;
	tiles[2] = size(16384, 8192);
	tiles[3] = [
		[
			size(512, 256),
			size(1024, 512),
			size(2048, 1024),
			size(4096, 2048),
			size(8192, 4096),
			size(16384, 8192),
		],
		size(512, 512),
	];
	tiles[9] = panoId;
	const attribution: unknown[] = [];
	attribution[0] = [
		[
			[prefix === BAIDU_VIEWER_PREFIX ? "Baidu" : "Tencent"],
			prefix === BAIDU_VIEWER_PREFIX ? "https://map.baidu.com" : "https://map.qq.com",
		],
	];
	const locationEntry: unknown[] = [];
	locationEntry[0] = [IMAGE_OK];
	locationEntry[1] = imageLocation(latLng(meta.position.lat, meta.position.lng), meta.heading);
	locationEntry[3] = [panoramas];
	locationEntry[6] = links;
	locationEntry[8] = times;
	const result: unknown[] = [];
	result[0] = [IMAGE_OK];
	result[1] = imageKey(panoId);
	result[2] = tiles;
	result[4] = attribution;
	result[5] = [locationEntry];
	const capture = meta.timeline[0]?.date ?? parsePanoDate(meta.panoId, meta.source);
	const captureDate: unknown[] = [];
	captureDate[7] = [capture.getFullYear(), capture.getMonth() + 1, capture.getDate()];
	result[6] = captureDate;
	result[7] = [prefix === BAIDU_VIEWER_PREFIX ? "https://map.baidu.com" : "https://map.qq.com"];
	return result;
}

function makeAdapter(id: AdapterId, prefix: string, source: PanoSource): InjectAdapter {
	return {
		id,
		legacyPbMarker: new RegExp(`!2s${prefix}`),
		legacyIdPattern: new RegExp(`!2s(${prefix}[A-Za-z0-9_-]+)`, "g"),
		isPanoId: (value) => isPrefixed(value, prefix),
		idsFromGetMetadata: (body) => idsFromRequest(body, prefix),
		async handleGetMetadata(ids) {
			const metas = await Promise.all(
				ids.map(async (value) => {
					const raw = stripViewerPanoId(value);
					const meta = await getPanoramaProvider(source).getMetadata(raw);
					metadataCache.set(raw, meta);
					return metadataPayload(meta, prefix);
				}),
			);
			return [[RPC_OK], metas];
		},
		handleLegacyGetMetadata(ids) {
			return this.handleGetMetadata(ids);
		},
		rewriteTile(panoId, zoom, x, y) {
			const raw = stripViewerPanoId(panoId);
			const meta = metadataCache.get(raw);
			const provider = getPanoramaProvider(meta?.source ?? source);
			const level = Math.max(0, Math.min((meta?.tileLevels.length ?? 2) - 1, Math.floor(zoom / 2)));
			const dims = meta?.tileLevels[level];
			const col = dims ? x % dims.cols : x;
			const row = dims ? y % dims.rows : y;
			return provider.getTileUrl(raw, col, row, dims?.level ?? level);
		},
	};
}

const adapters: InjectAdapter[] = [
	makeAdapter("baidu", BAIDU_VIEWER_PREFIX, "baidu_pano"),
	makeAdapter("tencent", TENCENT_VIEWER_PREFIX, "qq_pano"),
];

export function getInjectAdapters(): InjectAdapter[] {
	return adapters;
}
export function ensureBuiltinInjectAdapters(): void {}
