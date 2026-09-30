import type { PolygonGeometry } from "@/bindings.gen";
import { polygonFeatureCollection, polygonsFromGeoJSON } from "@/lib/util/geojson";
import { normalizeGeneratorSettings, type GeneratorSettings } from "./engine/types";

const MEMBER = "generator";

export interface GeneratorPreset {
	settings: GeneratorSettings | null;
	tagName: string | null;
	polygons: PolygonGeometry[];
}

/** A GeoJSON FeatureCollection of the regions that also carries the generator settings. */
export function writeGeneratorPreset(
	settings: GeneratorSettings,
	tagName: string,
	polygons: PolygonGeometry[],
) {
	return { ...polygonFeatureCollection(polygons), [MEMBER]: { settings, tagName } };
}

/** Read a preset file. Plain GeoJSON reads as regions with no settings. */
export function readGeneratorPreset(data: unknown): GeneratorPreset {
	const member = (data as { [MEMBER]?: { settings?: unknown; tagName?: unknown } } | null)?.[
		MEMBER
	];
	return {
		settings: member?.settings ? normalizeGeneratorSettings(member.settings) : null,
		tagName: typeof member?.tagName === "string" ? member.tagName : null,
		polygons: polygonsFromGeoJSON(data),
	};
}
