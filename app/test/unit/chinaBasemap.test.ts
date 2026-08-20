import { describe, expect, it } from "vitest";
import {
	activeChinaPanoProvider,
	activeCoverageOpacity,
	activeCoverageProviders,
	BAIDU_COVERAGE_SOURCE,
	chinaBasemapStyle,
	COVERAGE_LAYER_PREFIX,
} from "@/lib/map/chinaBasemap";
import { DEFAULT_PREFS } from "@/store/mapEmbedPrefs";

const layer = (provider: "baidu" | "tencent", id: string) =>
	chinaBasemapStyle({ ...DEFAULT_PREFS, panoProvider: provider }).layers.find(
		(item) => item.id === id,
	);

describe("China basemap coverage composition", () => {
	it("keeps Baidu raster coverage in the MapLibre style", () => {
		const style = chinaBasemapStyle(DEFAULT_PREFS);
		expect(style.sources[BAIDU_COVERAGE_SOURCE]).toMatchObject({
			type: "raster",
			tiles: ["mma-baidu://tiles/{z}/{x}/{y}"],
		});
		expect(style.sources.petal).toMatchObject({
			type: "raster",
			maxzoom: 19,
		});
	});

	it("hides Baidu's raster layer when Tencent is selected", () => {
		expect(layer("baidu", `${COVERAGE_LAYER_PREFIX}-baidu`)?.layout).toMatchObject({
			visibility: "visible",
		});
		expect(layer("tencent", `${COVERAGE_LAYER_PREFIX}-baidu`)?.layout).toMatchObject({
			visibility: "none",
		});
	});

	it("activates coverage only for the selected provider", () => {
		expect(activeCoverageProviders("baidu", 0.5)).toEqual({ baidu: true, tencent: false });
		expect(activeCoverageProviders("tencent", 0.5)).toEqual({ baidu: false, tencent: true });
		expect(activeCoverageProviders("baidu", 0)).toEqual({ baidu: false, tencent: false });
		expect(activeCoverageProviders("tencent", 0)).toEqual({ baidu: false, tencent: false });
	});

	it("falls back stale provider values to Baidu", () => {
		expect(activeChinaPanoProvider("google")).toBe("baidu");
		expect(activeChinaPanoProvider(undefined)).toBe("baidu");
	});

	it("normalizes missing and out-of-range coverage opacity", () => {
		expect(activeCoverageOpacity(undefined)).toBe(0.5);
		expect(activeCoverageOpacity(0)).toBe(0);
		expect(activeCoverageOpacity(2)).toBe(1);
	});
});
