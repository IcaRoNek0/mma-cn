import { FetchSource, PMTiles, type RangeResponse, type Source } from "pmtiles";
import { cmd } from "@/lib/commands";
import { log } from "@/lib/util/log";

export const TENCENT_COVERAGE_ARCHIVE_KEY = "mma-tencent-coverage";

/** PMTiles source backed by the startup-prepared Rust cache, with the remote
 * archive retained as a fallback if startup download is unavailable. */
export class CachedTencentCoverageSource implements Source {
	private readonly remote: FetchSource;
	private localState: "unknown" | "downloading" | "ready" | "unavailable" = "unknown";

	constructor(remoteUrl: string) {
		this.remote = new FetchSource(remoteUrl);
	}

	getKey(): string {
		return TENCENT_COVERAGE_ARCHIVE_KEY;
	}

	private async startLocalCache(): Promise<void> {
		if (this.localState !== "unknown") return;
		try {
			if (await cmd.tencentCoverageIsCached()) {
				this.localState = "ready";
				return;
			}
			this.localState = "downloading";
			void cmd
				.tencentCoveragePrepare()
				.then(() => {
					this.localState = "ready";
				})
				.catch((error) => {
					this.localState = "unavailable";
					log.warn("Tencent coverage cache download failed; keeping the remote archive", error);
				});
		} catch (error) {
			this.localState = "unavailable";
			log.warn("Tencent coverage cache check failed; keeping the remote archive", error);
		}
	}

	async getBytes(
		offset: number,
		length: number,
		signal?: AbortSignal,
		etag?: string,
	): Promise<RangeResponse> {
		await this.startLocalCache();
		if (this.localState === "ready") {
			try {
				const bytes = await cmd.tencentCoverageRead(offset, length);
				signal?.throwIfAborted();
				return { data: Uint8Array.from(bytes).buffer as ArrayBuffer };
			} catch (error) {
				if (signal?.aborted) throw error;
				this.localState = "unavailable";
				log.warn("Tencent coverage local cache unavailable; using the remote archive", error);
			}
		}
		return this.remote.getBytes(offset, length, signal, etag);
	}
}

export function cachedTencentCoverage(remoteUrl: string): PMTiles {
	return new PMTiles(new CachedTencentCoverageSource(remoteUrl));
}
