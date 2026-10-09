// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createLocation } from "@/types";
import { fallbackPanoramaMetadata } from "@/lib/pano/types";
import { metadataToPano, chinaPano } from "@/lib/pano/bridge";

const provider = vi.hoisted(() => ({ getMetadata: vi.fn() }));
vi.mock("@/lib/pano/index", async (original) => ({
	...(await original<typeof import("@/lib/pano/index")>()),
	getPanoramaProvider: () => provider,
}));

describe("China metadata in the migrated editor", () => {
	it("keeps GCJ coordinates and the Trekker tile layout", () => {
		const metadata = fallbackPanoramaMetadata("qq_trekker", "unknown", { lat: 30, lng: 120 });
		const pano = metadataToPano(metadata);
		expect(pano).toMatchObject({
			lat: 30,
			lng: 120,
			source: "qq_trekker",
			cameraType: "trekker",
			date: null,
			imageDate: "",
		});
		expect(pano.tileSize).toEqual({ width: 896, height: 896 });
		expect(pano.worldSize).toEqual({ width: 3584, height: 1792 });
	});
	it("loads provider metadata without sending a China id to Google", async () => {
		const metadata = fallbackPanoramaMetadata("baidu_pano", "01000100002403151230", {
			lat: 30,
			lng: 120,
		});
		provider.getMetadata.mockResolvedValue(metadata);
		const signal = new AbortController().signal;
		const pano = await chinaPano(
			createLocation({
				lat: 30,
				lng: 120,
				panoId: metadata.panoId,
				extra: { source: "baidu_pano" },
			}),
			signal,
		);
		expect(provider.getMetadata).toHaveBeenCalledWith(metadata.panoId, signal);
		expect(pano?.source).toBe("baidu_pano");
	});
});
