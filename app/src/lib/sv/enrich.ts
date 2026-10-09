import { chinaPano, locationSource } from "@/lib/pano/bridge";
import { getPanoramaProvider, isPanoSource, parsePanoDate } from "@/lib/pano";
import { runConcurrent } from "@/lib/util/concurrent";
import { msg } from "@/lib/i18n";
import { getMapState, query, updateLocations } from "@/store/useMapStore";
import { getProviders, getDefaultEnrichKeys } from "@/lib/data/fieldDefs";
import { runProviders, type ProcedureOutcome, type RunOpts } from "@/lib/data/procedures";
import { enrichRuns, panoResolveProvider } from "@/lib/sv/providers";
import { all, any, lacks } from "@/store/selections";
import type { Location, Selector } from "@/bindings.gen";

/** Enrich a single location with the map's enabled metadata fields. Existing fields are
 *  kept unless `force` re-derives all of them. Returns the enriched location without
 *  writing it. Returns the location unchanged when enrichment is disabled. */
export async function enrich(
	loc: Location,
	opts: Omit<RunOpts, "onProgress"> = {},
): Promise<Location> {
	const map = getMapState().map;
	if (!map || !map.settings.enrichMetadata) return loc;
	if (isPanoSource(loc.extra?.source)) return enrichChina(loc, opts);
	const runs = enrichRuns(map.settings.enrichFields ?? getDefaultEnrichKeys());
	const { rows } = await runProviders(runs, [loc], opts);
	return rows[0];
}

async function enrichChina(loc: Location, opts: Omit<RunOpts, "onProgress">): Promise<Location> {
	const map = getMapState().map!;
	{
		const source = locationSource(loc);
		let resolved = loc;
		if (!loc.panoId) {
			const nearest = await getPanoramaProvider(source).findNearest(loc, 18, opts.signal);
			if (!nearest) return loc;
			resolved = { ...loc, panoId: nearest.panoId };
		}
		const pano = await chinaPano(resolved, opts.signal);
		if (!pano) return loc;
		const wanted = new Set(map.settings.enrichFields ?? getDefaultEnrichKeys());
		const values: Record<string, unknown> = {
			imageDate: pano.imageDate,
			coverageDates: pano.coverageDates,
			altitude: pano.altitude,
			cameraType: pano.cameraType,
			drivingDirection: pano.centerHeading,
			datetime: pano.date ? parsePanoDate(pano.id, source).toISOString() : null,
		};
		const extra = { ...loc.extra };
		for (const [key, value] of Object.entries(values)) {
			if (wanted.has(key) && value != null && (opts.force || extra[key] == null))
				extra[key] = value;
		}
		const row = { ...resolved, extra: { ...extra, source: pano.source } };
		opts.onPartial?.([row]);
		return row;
	}
}

/** One summary row per pass that did work: the core metadata pass, then every
 *  provider that updated or failed at least one location. */
export interface EnrichOutcome extends ProcedureOutcome {
	id: string;
	label: string;
}
/** Bulk-enrich a selector: resolve missing pano ids, then run every field-producing
 *  provider (metadata, exact date, timezone, subdivision). */
export async function enrichAll(selector: Selector, opts: RunOpts = {}): Promise<EnrichOutcome[]> {
	const map = getMapState().map;
	if (!map) return [];
	const rows = await query(selector).locations();
	const china = rows.filter((row) => isPanoSource(row.extra?.source));
	if (china.length > 0) {
		const failed: number[] = [];
		let done = 0;
		const updates: { id: number; patch: { panoId: string | null; extra: Location["extra"] } }[] =
			[];
		await runConcurrent(
			china,
			async (row) => {
				try {
					const enriched = await enrichChina(row, opts);
					opts.signal?.throwIfAborted();
					updates.push({ id: row.id, patch: { panoId: enriched.panoId, extra: enriched.extra } });
				} catch (error) {
					if (opts.signal?.aborted) throw error;
					failed.push(row.id);
				}
				done++;
				opts.onProgress?.(done, china.length, [
					{
						label: msg("Metadata"),
						done,
						total: china.length,
						failed: failed.length,
						finished: done === china.length,
					},
				]);
			},
			{ concurrency: 8, signal: opts.signal },
		);
		opts.signal?.throwIfAborted();
		if (updates.length) await updateLocations(updates);
		const other = rows.filter((row) => !isPanoSource(row.extra?.source));
		const rest = other.length
			? await enrichAll(
					{ type: "Locations", locations: other.map((row) => row.id), name: null },
					opts,
				)
			: [];
		return [
			{
				id: "chinaMetadata",
				label: msg("Metadata"),
				succeeded: china.length - failed.length,
				failed,
			},
			...rest,
		];
	}
	const enrichFields = map.settings.enrichFields ?? getDefaultEnrichKeys();

	// Resolving is a means to a row's metadata, not a goal: a row holding every wanted
	// field keeps its coordinates-only state. Force re-derives fields, never panos.
	const resolve = opts.force
		? panoResolveProvider
		: {
				...panoResolveProvider,
				procedure: {
					...panoResolveProvider.procedure,
					select: all(selector, any(...enrichFields.map(lacks))),
				},
			};
	const run = await runProviders(
		[{ provider: resolve, force: false }, ...enrichRuns(enrichFields)],
		selector,
		opts,
	);
	const labelOf = (id: string) => getProviders().find((p) => p.id === id)?.label ?? id;
	return Object.entries(run)
		.filter(([, o]) => o.succeeded > 0 || o.failed.length > 0)
		.map(([id, o]) => ({ id, label: labelOf(id), ...o }));
}
