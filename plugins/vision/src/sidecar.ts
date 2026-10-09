// The app owns the sidecar process: `search-text`, `search-image`, and `list-cached`
// are answered by a resident mma-vision (declared under `serve` in the manifest), so
// repeat queries skip the ONNX/tokenizer/cache load. `embed` gets a one-shot run.

const { sidecar } = MMA;

export interface SearchResult {
	panoId: string;
	score: number;
}

interface SearchResponse {
	results: SearchResult[];
}

interface EmbedStatus {
	panoId: string;
	status: string;
	error?: string;
	done?: number;
	total?: number;
}

async function listCached(): Promise<Set<string>> {
	const ids = await sidecar.request<string[]>("vision", "list-cached");
	return new Set(ids ?? []);
}

export interface EmbedOptions {
	/** Human-readable phase, for the UI. */
	onStatus?(message: string): void;
	/** How many panos the last line accounted for. */
	onUnit?(count: number): void;
	/** A pano the sidecar could not embed. */
	onFailed?(panoId: string, error: string | undefined): void;
	/** Sidecar output that isn't progress -- inference and encoder faults carry no prefix. */
	onDiagnostic?(line: string): void;
	signal?: AbortSignal;
}

/** Embed every pano not already cached, so a search can cover `panoIds`. */
export async function embed(panoIds: string[], opts: EmbedOptions = {}): Promise<void> {
	opts.onStatus?.("Checking cache...");
	const cached = await listCached();
	const uncached = panoIds.filter((id) => !cached.has(id));
	if (uncached.length === 0) {
		opts.onStatus?.(`All ${panoIds.length} panos cached`);
		return;
	}

	await sidecar.request<EmbedStatus>(
		"vision",
		"embed",
		{ panoIds: uncached },
		{
			signal: opts.signal,
			onLog: (line) => {
				if (line.startsWith("[vision]")) opts.onStatus?.(line);
				else opts.onDiagnostic?.(line);
			},
			onLine: (s) => {
				if (s.status === "error") opts.onFailed?.(s.panoId, s.error);
				else opts.onUnit?.(s.status === "cache_hit" ? (s.done ?? 1) : 1);
			},
		},
	);
}

export async function searchText(
	query: string,
	k: number | null,
	threshold: number | null,
	signal?: AbortSignal,
	onDiagnostic?: (line: string) => void,
): Promise<SearchResult[]> {
	const res = await sidecar.request<SearchResponse>(
		"vision",
		"search-text",
		{ query, k, threshold },
		{
			signal,
			onLog: (line) => {
				if (!line.startsWith("[vision]")) onDiagnostic?.(line);
			},
		},
	);
	return res?.results ?? [];
}

export async function searchImage(
	panoId: string,
	k: number | null,
	threshold: number | null,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const res = await sidecar.request<SearchResponse>(
		"vision",
		"search-image",
		{ panoId, k, threshold },
		{ signal },
	);
	return res?.results ?? [];
}
