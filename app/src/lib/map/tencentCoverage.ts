import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import { coverageError } from "@/lib/map/coverageDebug";
import { schemeBase } from "@/lib/util/util";

// The backend serves exact byte ranges from the vendored archive, avoiding the
// frontend asset resolver, which excludes this large binary from --serve builds.
export const TENCENT_COVERAGE_ARCHIVE_URL = `${schemeBase("mma-tencent-archive")}range`;

export class BundledTencentCoverageSource implements Source {
	getKey(): string {
		return TENCENT_COVERAGE_ARCHIVE_URL;
	}

	async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
		const url = `${TENCENT_COVERAGE_ARCHIVE_URL}?offset=${offset}&length=${length}`;
		try {
			const response = await fetch(url, { signal });
			const data = await response.arrayBuffer();
			if (!response.ok) {
				throw new Error(`Bundled Tencent coverage returned HTTP ${response.status}`);
			}
			if (data.byteLength !== length) {
				throw new Error(
					`Bundled Tencent coverage returned ${data.byteLength} bytes, expected ${length}`,
				);
			}
			return { data };
		} catch (error) {
			if (!signal?.aborted) {
				coverageError("tencent", `local archive request failed (${offset}, ${length})`, error);
			}
			throw error;
		}
	}
}

export function bundledTencentCoverage(): PMTiles {
	return new PMTiles(new BundledTencentCoverageSource());
}
