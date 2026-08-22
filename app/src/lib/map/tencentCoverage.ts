import { PMTiles, type RangeResponse, type Source } from "pmtiles";

// This file is copied to Vite's output unchanged and is therefore available in
// both the desktop bundle and the web-serve build without a startup download.
export const TENCENT_COVERAGE_ARCHIVE_URL = "/tencent-lines.pmtiles";

class BundledTencentCoverageSource implements Source {
	private completeArchive: ArrayBuffer | null = null;

	getKey(): string {
		return TENCENT_COVERAGE_ARCHIVE_URL;
	}

	async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
		if (this.completeArchive) {
			return { data: this.completeArchive.slice(offset, offset + length) };
		}
		const response = await fetch(TENCENT_COVERAGE_ARCHIVE_URL, {
			signal,
			headers: { Range: `bytes=${offset}-${offset + length - 1}` },
		});
		if (!response.ok) throw new Error(`Bundled Tencent coverage returned HTTP ${response.status}`);
		const data = await response.arrayBuffer();
		if (response.status === 206) return { data };

		// Tauri's asset resolver and the web-serve bridge can answer a range request
		// with the complete local asset. Retain it once and serve subsequent slices.
		this.completeArchive = data;
		return { data: data.slice(offset, offset + length) };
	}
}

export function bundledTencentCoverage(): PMTiles {
	return new PMTiles(new BundledTencentCoverageSource());
}
