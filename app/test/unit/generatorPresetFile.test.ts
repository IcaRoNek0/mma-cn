import { describe, expect, it } from "vitest";
import type { PolygonGeometry } from "@/bindings.gen";
import { polygonFeatureCollection, polygonsFromGeoJSON } from "@/lib/util/geojson";
import { DEFAULT_SETTINGS } from "@/plugins/generator/engine/types";
import { readGeneratorPreset, writeGeneratorPreset } from "@/plugins/generator/presetFile";

const square: [number, number][][] = [
	[
		[0, 0],
		[1, 0],
		[1, 1],
		[0, 0],
	],
];
const island: [number, number][][] = [
	[
		[5, 5],
		[6, 5],
		[6, 6],
		[5, 5],
	],
];
const single: PolygonGeometry = {
	coordinates: square,
	extraPolygons: null,
	properties: { name: "A" },
};
const multi: PolygonGeometry = {
	coordinates: square,
	extraPolygons: [island],
	properties: { name: "B" },
};

const roundTrip = (polygons: PolygonGeometry[]) =>
	polygonsFromGeoJSON(JSON.parse(JSON.stringify(polygonFeatureCollection(polygons))));

describe("polygon GeoJSON", () => {
	it("round-trips every part of a multi-part polygon", () => {
		expect(roundTrip([single, multi])).toEqual([single, multi]);
	});

	it("writes a multi-part polygon as a MultiPolygon", () => {
		expect(polygonFeatureCollection([multi]).features[0].geometry.type).toBe("MultiPolygon");
	});

	it("reads a bare Feature and skips non-polygon geometry", () => {
		const point = { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] } };
		expect(polygonsFromGeoJSON(point)).toEqual([]);
		expect(polygonsFromGeoJSON(polygonFeatureCollection([single]).features[0])).toEqual([single]);
		expect(polygonsFromGeoJSON(null)).toEqual([]);
	});
});

describe("generator preset file", () => {
	it("round-trips settings, tag name and regions", () => {
		const settings = { ...DEFAULT_SETTINGS, radius: 250, objective: "spacing" as const };
		const file = JSON.parse(
			JSON.stringify(writeGeneratorPreset(settings, "trip", [single, multi])),
		);
		expect(readGeneratorPreset(file)).toEqual({
			settings,
			tagName: "trip",
			polygons: [single, multi],
		});
	});

	it("stays loadable as plain GeoJSON regions", () => {
		const file = writeGeneratorPreset(DEFAULT_SETTINGS, "", [multi]);
		expect(polygonsFromGeoJSON(file)).toEqual([multi]);
	});

	it("reads plain GeoJSON as regions without settings", () => {
		const preset = readGeneratorPreset(polygonFeatureCollection([single]));
		expect(preset).toEqual({ settings: null, tagName: null, polygons: [single] });
	});

	it("normalizes imported settings", () => {
		const file = {
			type: "FeatureCollection",
			features: [],
			generator: { settings: { samplingMode: "bogus" } },
		};
		expect(readGeneratorPreset(file).settings).toEqual(DEFAULT_SETTINGS);
	});
});
