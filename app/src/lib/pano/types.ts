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
	position?: GcjPoint;
	distanceMeters?: number;
	/** Only direct road neighbours and explicit junction links get a visible move marker. */
	adjacent?: boolean;
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
	findNearest(
		point: GcjPoint,
		zoom: number,
		signal?: AbortSignal,
	): Promise<PanoSearchResult | null>;
	getMetadata(panoId: string, signal?: AbortSignal): Promise<PanoramaMetadata>;
	getTileUrl(panoId: string, col: number, row: number, level: number): string;
}

export class PanoramaProviderError extends Error {
	readonly provider: PanoSource;
	readonly cause?: unknown;
	constructor(message: string, provider: PanoSource, cause?: unknown) {
		super(message);
		this.provider = provider;
		this.cause = cause;
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

export interface PanoCaptureParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

/** Provider civil time, validated without the computer's timezone or DST. */
export function parsePanoCaptureParts(panoId: string, source: PanoSource): PanoCaptureParts | null {
	const start = source === "baidu_pano" ? 10 : 8;
	const stamp = panoId.slice(start, start + 12);
	if (!/^\d{12}$/.test(stamp)) return null;
	const values = stamp.match(/.{2}/g)!.map(Number);
	const parts = {
		year: 2000 + values[0]!,
		month: values[1]!,
		day: values[2]!,
		hour: values[3]!,
		minute: values[4]!,
		second: values[5]!,
	};
	const date = new Date(
		Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
	);
	return date.getUTCFullYear() === parts.year &&
		date.getUTCMonth() === parts.month - 1 &&
		date.getUTCDate() === parts.day &&
		date.getUTCHours() === parts.hour &&
		date.getUTCMinutes() === parts.minute &&
		date.getUTCSeconds() === parts.second
		? parts
		: null;
}

/** Legacy local Date representation; prefer civil parts for capture-time display. */
export function parsePanoCaptureDate(panoId: string, source: PanoSource): Date | null {
	const parts = parsePanoCaptureParts(panoId, source);
	return parts
		? new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
		: null;
}
export function parsePanoDate(panoId: string, source: PanoSource): Date {
	return parsePanoCaptureDate(panoId, source) ?? new Date(0);
}
export function parsePanoVehicle(panoId: string, source: PanoSource): string | null {
	const valid = source === "baidu_pano" ? /^\d{26}[A-Za-z]$/.test(panoId) : /^\d{23}$/.test(panoId);
	if (!valid) return null;
	return source === "baidu_pano"
		? `${panoId.slice(0, 3)}_${panoId.slice(5, 9)}_${panoId.slice(-2)}`
		: `${panoId.slice(0, 4)}-${panoId.slice(5, 8)}车`;
}
