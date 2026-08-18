export type PanoSource = "baidu_pano" | "qq_pano" | "qq_trekker";

export interface GcjPoint {
	lat: number;
	lng: number;
}

export interface PanoSearchResult {
	panoId: string;
	heading: number;
	/** Provider coordinates returned by a lightweight coverage lookup. */
	position?: GcjPoint;
}

export interface PanoramaLink {
	panoId: string;
	heading?: number;
	label?: string;
}

export interface PanoramaVersion {
	panoId: string;
	date: Date;
}

export interface PanoramaTileLevel {
	level: number;
	width: number;
	cols: number;
	rows: number;
	tileWidth: number;
	tileHeight: number;
}

export interface PanoramaMetadata {
	panoId: string;
	source: PanoSource;
	position: GcjPoint;
	heading: number;
	northOffset: number;
	pitch: number;
	address: string | null;
	altitude: number | null;
	links: PanoramaLink[];
	timeline: PanoramaVersion[];
	tileLevels: PanoramaTileLevel[];
}

export interface PanoramaProvider {
	readonly source: PanoSource;
	findNearest(point: GcjPoint, zoom: number, signal?: AbortSignal): Promise<PanoSearchResult | null>;
	getMetadata(panoId: string, signal?: AbortSignal): Promise<PanoramaMetadata>;
	getTileUrl(panoId: string, col: number, row: number, level: number): string;
}

export class PanoramaProviderError extends Error {
	constructor(
		message: string,
		readonly provider: PanoSource,
		readonly cause?: unknown,
	) {
		super(message);
		this.name = "PanoramaProviderError";
	}
}

/**
 * Build enough metadata for a pano whose imagery endpoint works but whose
 * provider metadata endpoint does not. This keeps tile-only panoramas usable
 * without pretending that address, links, or dates were resolved.
 */
export function fallbackPanoramaMetadata(
	source: PanoSource,
	panoId: string,
	position: GcjPoint,
): PanoramaMetadata {
	const tileLevels =
		source === "baidu_pano"
			? [
					{ level: 0, width: 2048, cols: 4, rows: 2, tileWidth: 512, tileHeight: 512 },
					{ level: 1, width: 8192, cols: 16, rows: 8, tileWidth: 512, tileHeight: 512 },
			  ]
			: source === "qq_trekker"
				? [{ level: 0, width: 3584, cols: 8, rows: 2, tileWidth: 896, tileHeight: 896 }]
				: [
						{ level: 0, width: 4096, cols: 8, rows: 4, tileWidth: 512, tileHeight: 512 },
						{ level: 1, width: 8192, cols: 16, rows: 8, tileWidth: 512, tileHeight: 512 },
				  ];
	return {
		panoId,
		source,
		position,
		heading: 0,
		northOffset: 0,
		pitch: 0,
		address: null,
		altitude: null,
		links: [],
		timeline: [],
		tileLevels,
	};
}

export function parsePanoDate(panoId: string, source: PanoSource): Date {
	const yearStart = source === "baidu_pano" ? 10 : 8;
	const monthStart = source === "baidu_pano" ? 12 : 10;
	const year = Number.parseInt(panoId.slice(yearStart, yearStart + 2), 10);
	const month = Number.parseInt(panoId.slice(monthStart, monthStart + 2), 10);
	const day = Number.parseInt(panoId.slice(monthStart + 2, monthStart + 4), 10) || 1;
	const hour = Number.parseInt(panoId.slice(monthStart + 4, monthStart + 6), 10) || 0;
	const minute = Number.parseInt(panoId.slice(monthStart + 6, monthStart + 8), 10) || 0;
	if (!Number.isFinite(year) || !Number.isFinite(month)) return new Date(0);
	return new Date(2000 + year, month - 1, day, hour, minute);
}
