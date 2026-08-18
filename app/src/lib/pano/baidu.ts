import { bd09McToGcj02, gcj02ToBd09Mc } from "./coords";
import { fetchWithTimeout } from "./fetch";
import {
	PanoramaProviderError,
	parsePanoDate,
	type GcjPoint,
	type PanoramaLink,
	type PanoramaMetadata,
	type PanoramaProvider,
	type PanoramaVersion,
	type PanoSearchResult,
} from "./types";

interface BaiduSearchResponse {
	content?: { id?: string; x?: number; y?: number };
	result?: { error?: number };
}

interface BaiduPanoNode {
	PID?: string;
	DIR?: number;
	Order?: number;
}

interface BaiduMetadataEntry {
	ID?: string;
	X?: number;
	Y?: number;
	Z?: number;
	Rname?: string;
	Heading?: number;
	MoveDir?: number;
	NorthDir?: number;
	Pitch?: number;
	Roads?: { IsCurrent?: number; Panos?: BaiduPanoNode[] }[];
	Links?: { PID?: string; DIR?: number }[];
	TimeLine?: { ID?: string; TimeLine?: string }[];
}

interface BaiduMetadataResponse {
	content?: BaiduMetadataEntry[];
	result?: { error?: number };
}

function baiduTimeline(items: BaiduMetadataEntry["TimeLine"]): PanoramaVersion[] {
	return (items ?? []).flatMap((item) => {
		if (!item.ID) return [];
		const ym = item.TimeLine?.match(/^(\d{4})(\d{2})$/);
		const date = ym ? new Date(Number(ym[1]), Number(ym[2]) - 1) : parsePanoDate(item.ID, "baidu_pano");
		return [{ panoId: item.ID, date }];
	});
}

function baiduLinks(meta: BaiduMetadataEntry): PanoramaLink[] {
	const links = new Map<string, PanoramaLink>();
	for (const road of meta.Roads ?? []) {
		if (!road.IsCurrent) continue;
		for (const node of road.Panos ?? []) {
			if (node.PID && node.PID !== meta.ID) {
				links.set(node.PID, { panoId: node.PID, heading: node.DIR });
			}
		}
	}
	for (const link of meta.Links ?? []) {
		if (link.PID && link.PID !== meta.ID) {
			links.set(link.PID, { panoId: link.PID, heading: link.DIR });
		}
	}
	return [...links.values()];
}

export class BaiduPanoramaProvider implements PanoramaProvider {
	readonly source = "baidu_pano" as const;

	async findNearest(point: GcjPoint, zoom: number, signal?: AbortSignal): Promise<PanoSearchResult | null> {
		try {
			const [x, y] = gcj02ToBd09Mc(point);
			const level = Math.min(17, Math.max(3, Math.round(zoom)));
			const url = `https://mapsv0.bdimg.com/?qt=qsdata&x=${x}&y=${y}&l=${level}`;
			const data = (await fetchWithTimeout(url, signal ? { signal } : {}).then((r) =>
				r.json(),
			)) as BaiduSearchResponse;
			const panoId = data.content?.id;
			if (!panoId) return null;
			const responseX = Number(data.content?.x);
			const responseY = Number(data.content?.y);
			return {
				panoId,
				heading: 0,
				...(Number.isFinite(responseX) && Number.isFinite(responseY)
					? { position: bd09McToGcj02(responseX / 100, responseY / 100) }
					: {}),
			};
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") throw error;
			return null;
		}
	}

	async getMetadata(panoId: string, signal?: AbortSignal): Promise<PanoramaMetadata> {
		try {
			const url = `https://mapsv0.bdimg.com/?qt=sdata&sid=${encodeURIComponent(panoId)}`;
			const data = (await fetchWithTimeout(url, signal ? { signal } : {}).then((r) =>
				r.json(),
			)) as BaiduMetadataResponse;
			const meta = data.content?.[0];
			if (!meta?.ID || !Number.isFinite(meta.X) || !Number.isFinite(meta.Y)) {
				throw new Error("metadata payload is incomplete");
			}
			return {
				panoId: meta.ID,
				source: this.source,
				position: bd09McToGcj02(meta.X! / 100, meta.Y! / 100),
				heading: meta.MoveDir ?? meta.Heading ?? 0,
				northOffset: meta.NorthDir ?? 0,
				pitch: meta.Pitch ?? 0,
				address: meta.Rname || null,
				altitude: Number.isFinite(meta.Z) ? meta.Z! : null,
				links: baiduLinks(meta),
				timeline: baiduTimeline(meta.TimeLine),
				tileLevels: [
					{ level: 0, width: 2048, cols: 4, rows: 2, tileWidth: 512, tileHeight: 512 },
					{ level: 1, width: 8192, cols: 16, rows: 8, tileWidth: 512, tileHeight: 512 },
				],
			};
		} catch (error) {
			throw new PanoramaProviderError(`百度街景 ${panoId} 元数据获取失败`, this.source, error);
		}
	}

	getTileUrl(panoId: string, col: number, row: number, level: number): string {
		const z = level === 0 ? 3 : 5;
		return `https://mapsv0.bdimg.com/?qt=pdata&sid=${encodeURIComponent(panoId)}&pos=${row}_${col}&z=${z}`;
	}
}
