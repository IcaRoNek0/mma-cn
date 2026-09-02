import { fetchWithTimeout, responseJsonGbk } from "./fetch";
import {
	PanoramaProviderError,
	parsePanoDate,
	type GcjPoint,
	type PanoramaLink,
	type PanoramaMetadata,
	type PanoramaProvider,
	type PanoramaTileLevel,
	type PanoramaVersion,
	type PanoSearchResult,
	type PanoSource,
} from "./types";

interface TencentSearchResponse {
	detail?: { svid?: string; heading?: number | string };
}

export interface TencentMetadataResponse {
	detail?: {
		addr?: { x_lng?: number; y_lat?: number };
		basic?: {
			svid?: string;
			dir?: number | string;
			append_addr?: string;
			tile_width?: string;
			tile_height?: string;
			level0?: string;
			level1?: string;
			trans_svid?: string;
			x?: number;
			y?: number;
		};
		history?: { nodes?: { svid?: string }[] };
		roads?: {
			name?: string;
			points?: { svid?: string; x?: number; y?: number; order?: number | string }[];
		}[];
		vpoints?: {
			svid?: string;
			link?: { svid?: string; x?: number; y?: number }[];
		}[];
		all_scenes?: { svid?: string; x?: number; y?: number }[];
		tile?: {
			definitions?: {
				id?: string;
				row?: string;
				column?: string;
				tile_width?: string;
				tile_height?: string;
			}[];
		};
	};
}

// The live Trekker endpoint currently serves x=0..7 although metadata advertises 12.
// The user-approved runtime contract is the service's readable 8x2 grid.
export const TENCENT_TREKKER_COLUMNS = 8;

function parseGrid(value: string | undefined): { rows: number; cols: number } | null {
	const match = value?.match(/^(\d+)\*(\d+)$/);
	if (!match) return null;
	return { rows: Number(match[1]), cols: Number(match[2]) };
}

export function tencentTileLevels(
	data: TencentMetadataResponse,
	source: "qq_pano" | "qq_trekker",
): PanoramaTileLevel[] {
	if (source === "qq_trekker") {
		const definition = data.detail?.tile?.definitions?.find((d) => d.id === "hd");
		const rows = Number(definition?.row);
		const cols = TENCENT_TREKKER_COLUMNS;
		const tileWidth = Number(definition?.tile_width);
		const tileHeight = Number(definition?.tile_height);
		if ([rows, cols, tileWidth, tileHeight].every((n) => Number.isFinite(n) && n > 0)) {
			// Trekker serves a cropped strip (8 square tiles x 2 rows), so use
			// the logical 2:1 width expected by PSV, not its physical pixel width.
			return [{ level: 0, width: rows * tileHeight * 2, cols, rows, tileWidth, tileHeight }];
		}
		throw new Error("Tencent Trekker metadata does not contain a valid hd tile definition");
	}
	const lowGrid = parseGrid(data.detail?.basic?.level0);
	const highGrid = parseGrid(data.detail?.basic?.level1) ?? { rows: 8, cols: 16 };
	const tileWidth = Number(data.detail?.basic?.tile_width) || 512;
	const tileHeight = Number(data.detail?.basic?.tile_height) || tileWidth;
	return [
		...(lowGrid
			? [
					{
						level: 0,
						width: lowGrid.cols * tileWidth,
						cols: lowGrid.cols,
						rows: lowGrid.rows,
						tileWidth,
						tileHeight,
					},
				]
			: []),
		{
			level: 1,
			width: highGrid.cols * tileWidth,
			cols: highGrid.cols,
			rows: highGrid.rows,
			tileWidth,
			tileHeight,
		},
	];
}

function headingBetween(
	from: { x?: number; y?: number },
	to: { x?: number; y?: number },
): number | undefined {
	if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return undefined;
	return ((Math.atan2(to.x! - from.x!, to.y! - from.y!) * 180) / Math.PI + 360) % 360;
}

const WEB_MERCATOR_METERS_PER_DEGREE = 111_319.49077777778;

function mercatorToGcjPoint(point: { x?: number; y?: number }): GcjPoint | undefined {
	if (![point.x, point.y].every(Number.isFinite)) return undefined;
	const lng = point.x! / WEB_MERCATOR_METERS_PER_DEGREE;
	const lat =
		(360 / Math.PI) *
			Math.atan(Math.exp((point.y! / WEB_MERCATOR_METERS_PER_DEGREE) * (Math.PI / 180))) -
		90;
	return { lng, lat };
}

function tencentLinks(data: TencentMetadataResponse): PanoramaLink[] {
	const current = data.detail?.basic?.svid;
	const currentPoint = data.detail?.basic ?? {};
	const links = new Map<string, PanoramaLink>();
	const addLink = (link: PanoramaLink) => {
		if (!link.panoId || link.panoId === current) return;
		const existing = links.get(link.panoId);
		if (existing?.adjacent && !link.adjacent) return;
		links.set(link.panoId, link);
	};

	for (const road of data.detail?.roads ?? []) {
		const points = road.points ?? [];
		const currentIndex = points.findIndex((point) => point.svid === current);
		if (currentIndex < 0) continue;
		const currentOrder = Number(points[currentIndex].order);
		for (const [index, point] of points.entries()) {
			if (!point.svid) continue;
			const order = Number(point.order);
			const adjacent =
				Number.isFinite(currentOrder) && Number.isFinite(order)
					? Math.abs(order - currentOrder) === 1
					: Math.abs(index - currentIndex) === 1;
			addLink({
				panoId: point.svid,
				heading: headingBetween(currentPoint, point),
				label: road.name,
				position: mercatorToGcjPoint(point),
				adjacent,
			});
		}
	}

	// vpoints describe explicit junction transitions, analogous to Baidu Links.
	for (const vertex of data.detail?.vpoints ?? []) {
		if (vertex.svid !== current) continue;
		for (const link of vertex.link ?? []) {
			if (!link.svid) continue;
			addLink({
				panoId: link.svid,
				heading: headingBetween(currentPoint, link),
				position: mercatorToGcjPoint(link),
				adjacent: true,
			});
		}
	}

	// Keep all_scenes navigable, but do not expose non-adjacent scenes as markers.
	for (const scene of data.detail?.all_scenes ?? []) {
		if (!scene.svid) continue;
		addLink({
			panoId: scene.svid,
			heading: headingBetween(currentPoint, scene),
			position: mercatorToGcjPoint(scene),
			adjacent: false,
		});
	}
	return [...links.values()];
}

function tencentTimeline(data: TencentMetadataResponse, source: PanoSource): PanoramaVersion[] {
	const ids = new Set<string>();
	for (const node of data.detail?.history?.nodes ?? []) if (node.svid) ids.add(node.svid);
	const trans = data.detail?.basic?.trans_svid;
	if (trans) ids.add(trans);
	return [...ids].map((panoId) => ({ panoId, date: parsePanoDate(panoId, source) }));
}

export class TencentPanoramaProvider implements PanoramaProvider {
	constructor(readonly source: "qq_pano" | "qq_trekker" = "qq_pano") {}

	async findNearest(
		point: GcjPoint,
		zoom: number,
		signal?: AbortSignal,
	): Promise<PanoSearchResult | null> {
		try {
			const radius = Math.min(10_000, Math.max(25, Math.round(50 * (20 - zoom) ** 2)));
			const url = `https://sv.map.qq.com/xf?lat=${point.lat}&lng=${point.lng}&r=${radius}&output=jsonv`;
			const data = await responseJsonGbk<TencentSearchResponse>(
				await fetchWithTimeout(url, signal ? { signal } : {}),
			);
			const panoId = data.detail?.svid;
			if (!panoId) return null;
			return { panoId, heading: Number(data.detail?.heading) || 0 };
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") throw error;
			return null;
		}
	}

	async getMetadata(panoId: string, signal?: AbortSignal): Promise<PanoramaMetadata> {
		try {
			const url = `https://sv.map.qq.com/sv?svid=${encodeURIComponent(panoId)}&output=json`;
			const data = await responseJsonGbk<TencentMetadataResponse>(
				await fetchWithTimeout(url, signal ? { signal } : {}),
			);
			const meta = data.detail?.basic;
			const addr = data.detail?.addr;
			if (!meta?.svid || !Number.isFinite(addr?.x_lng) || !Number.isFinite(addr?.y_lat)) {
				throw new Error("metadata payload is incomplete");
			}
			const resolvedSource =
				this.source === "qq_pano" &&
				data.detail?.tile?.definitions?.some((item) => item.id === "hd")
					? "qq_trekker"
					: this.source;
			return {
				panoId: meta.svid,
				source: resolvedSource,
				position: { lng: addr!.x_lng!, lat: addr!.y_lat! },
				heading: Number(meta.dir) || 0,
				northOffset: Number(meta.dir) || 0,
				pitch: 0,
				address: meta.append_addr || null,
				altitude: null,
				links: tencentLinks(data),
				timeline: tencentTimeline(data, resolvedSource),
				tileLevels: tencentTileLevels(data, resolvedSource),
			};
		} catch (error) {
			throw new PanoramaProviderError(`腾讯街景 ${panoId} 元数据获取失败`, this.source, error);
		}
	}

	getTileUrl(panoId: string, col: number, row: number, level: number): string {
		const seed = Number.parseInt(panoId.slice(-1), 10) || 0;
		const server = ((seed + col + row) % 4) + 1;
		if (this.source === "qq_trekker") {
			return `https://sv${server}.map.qq.com/tile?from=web&svid=${encodeURIComponent(panoId)}&level=0&x=${col}&y=${row}`;
		}
		return `https://sv${server}.map.qq.com/tile?svid=${encodeURIComponent(panoId)}&level=${level}&x=${col}&y=${row}`;
	}
}
