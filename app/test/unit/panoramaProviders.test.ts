import { afterEach, describe, expect, it, vi } from "vitest";
import { BaiduPanoramaProvider } from "@/lib/pano/baidu";
import { fallbackPanoramaMetadata } from "@/lib/pano/types";
import { gcj02ToBd09Mc, gcj02ToWgs84, wgs84ToGcj02 } from "@/lib/pano/coords";
import { TencentPanoramaProvider, tencentTileLevels } from "@/lib/pano/tencent";

afterEach(() => vi.unstubAllGlobals());

describe("panorama coordinate boundaries", () => {
	it("round-trips GCJ-02 through WGS-84", () => {
		const original = { lng: 116.397389, lat: 39.908722 };
		const roundTrip = wgs84ToGcj02(gcj02ToWgs84(original));
		expect(roundTrip.lng).toBeCloseTo(original.lng, 5);
		expect(roundTrip.lat).toBeCloseTo(original.lat, 5);
	});
});

describe("Tencent panorama metadata", () => {
	it("uses the standard level-1 grid from metadata", () => {
		expect(
			tencentTileLevels(
				{
					detail: {
						basic: {
							level0: "4*8",
							level1: "8*16",
							tile_width: "512",
							tile_height: "512",
						},
					},
				},
				"qq_pano",
			),
		).toEqual([
			{ level: 0, width: 4096, cols: 8, rows: 4, tileWidth: 512, tileHeight: 512 },
			{ level: 1, width: 8192, cols: 16, rows: 8, tileWidth: 512, tileHeight: 512 },
		]);
	});

	it("keeps level 1 when older metadata omits the low-resolution grid", () => {
		expect(
			tencentTileLevels(
				{ detail: { basic: { level1: "8*16", tile_width: "512", tile_height: "512" } } },
				"qq_pano",
			),
		).toEqual([{ level: 1, width: 8192, cols: 16, rows: 8, tileWidth: 512, tileHeight: 512 }]);
	});

	it("requests Tencent low and high tile levels from the same endpoint", () => {
		const provider = new TencentPanoramaProvider();
		expect(provider.getTileUrl("pano", 2, 1, 0)).toContain("level=0");
		expect(provider.getTileUrl("pano", 2, 1, 1)).toContain("level=1");
	});

	it("uses the Trekker hd definition without a hardcoded layout", () => {
		expect(
			tencentTileLevels(
				{
					detail: {
						tile: {
							definitions: [
								{
									id: "hd",
									row: "2",
									column: "12",
									tile_width: "896",
									tile_height: "896",
								},
							],
						},
					},
				},
				"qq_trekker",
			),
		).toEqual([{ level: 0, width: 3584, cols: 8, rows: 2, tileWidth: 896, tileHeight: 896 }]);
	});

	it("rejects Trekker metadata without a valid hd definition", () => {
		expect(() => tencentTileLevels({ detail: {} }, "qq_trekker")).toThrow(/hd tile definition/);
	});

	it("keeps only adjacent road panoramas as navigation links", async () => {
		const payload = {
			detail: {
				addr: { x_lng: 107.600322, y_lat: 37.549936 },
				basic: {
					svid: "current",
					dir: "90",
					x: 100,
					y: 100,
					append_addr: "test road",
					level1: "8*16",
					tile_width: "512",
					tile_height: "512",
				},
				roads: [
					{
						name: "test road",
						points: [
							{ svid: "far", x: 0, y: 100 },
							{ svid: "previous", x: 50, y: 100 },
							{ svid: "current", x: 100, y: 100 },
							{ svid: "next", x: 150, y: 100 },
						],
					},
				],
			},
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify(payload))),
		);

		const metadata = await new TencentPanoramaProvider().getMetadata("current");
		expect(metadata.links.map((link) => link.panoId)).toEqual(["previous", "next"]);
		expect(metadata.address).toBe("test road");
	});
});

describe("Baidu panorama metadata", () => {
	it("keeps qsdata coordinates when sdata is unavailable", async () => {
		const original = { lng: 106.1527149661, lat: 33.3291311369 };
		const [x, y] = gcj02ToBd09Mc(original);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ content: { id: "hidden", x: x * 100, y: y * 100 } }))),
		);

		const result = await new BaiduPanoramaProvider().findNearest(original, 13);
		expect(result?.panoId).toBe("hidden");
		expect(result?.heading).toBe(0);
		expect(result?.position?.lng).toBeCloseTo(original.lng, 5);
		expect(result?.position?.lat).toBeCloseTo(original.lat, 5);
	});

	it("provides tile levels for a pano without metadata", () => {
		const metadata = fallbackPanoramaMetadata("baidu_pano", "hidden", {
			lng: 106.15,
			lat: 33.33,
		});
		expect(metadata.heading).toBe(0);
		expect(metadata.address).toBeNull();
		expect(metadata.tileLevels.map((level) => [level.cols, level.rows])).toEqual([
			[4, 2],
			[16, 8],
		]);
	});

	it("converts provider coordinates back to GCJ-02 and exposes both tile levels", async () => {
		const original = { lng: 116.397389, lat: 39.908722 };
		const [x, y] = gcj02ToBd09Mc(original);
		const payload = {
			content: [
				{
					ID: "baidu-current",
					X: x * 100,
					Y: y * 100,
					MoveDir: 135,
					NorthDir: 15,
					Rname: "test road",
					Links: [{ PID: "baidu-next", DIR: 180 }],
				},
			],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify(payload))),
		);

		const metadata = await new BaiduPanoramaProvider().getMetadata("baidu-current");
		expect(metadata.position.lng).toBeCloseTo(original.lng, 5);
		expect(metadata.position.lat).toBeCloseTo(original.lat, 5);
		expect(metadata.links).toEqual([{ panoId: "baidu-next", heading: 180 }]);
		expect(metadata.tileLevels.map((level) => [level.cols, level.rows])).toEqual([
			[4, 2],
			[16, 8],
		]);
	});
});
