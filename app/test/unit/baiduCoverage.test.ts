import { describe, expect, it } from "vitest";
import { baiduCoverageTileIntersectsChina } from "@/lib/map/baiduCoverage";

describe("Baidu coverage tile bounds", () => {
	it("keeps a low-zoom tile whose corners miss China but whose area intersects it", () => {
		expect(baiduCoverageTileIntersectsChina(7, 2, 3)).toBe(true);
	});

	it("rejects tiles that do not intersect China", () => {
		expect(baiduCoverageTileIntersectsChina(4, 1, 3)).toBe(false);
	});

	it("normalizes wrapped world copies", () => {
		expect(baiduCoverageTileIntersectsChina(15, 2, 3)).toBe(true);
	});
});
