import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/util/log", async () => (await import("./fixtures/mocks")).logMock());
vi.mock("@/lib/commands", () => ({
	cmd: {
		polygonBounds: () => Promise.resolve([0, 0, 0.001, 0.001]),
		polygonContainsPoints: (_polygon: unknown, lats: number[]) =>
			Promise.resolve(lats.map(() => true)),
	},
}));
vi.mock("@/lib/geo/tiles", () => ({
	TileConfig: class {},
	LayerType: { STREETVIEW: 1 },
	buildSvCoverageConfig: () => ({ cc: "", svl: "", mapStyles: [] }),
	buildTileUrl: () => "https://tiles.test/tile",
}));

import { blueLineSource } from "@/plugins/generator/engine/blueLineSampler";
import type { PolygonGeometry } from "@/bindings.gen";

const polygon: PolygonGeometry = {
	coordinates: [
		[
			[0, 0],
			[0.001, 0],
			[0.001, 0.001],
			[0, 0.001],
			[0, 0],
		],
	],
	extraPolygons: null,
};

describe("spacing Coverage source", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"OffscreenCanvas",
			class {
				getContext() {
					return {};
				}
			},
		);
	});

	it("fails rather than declaring an incomplete tile plan exhausted", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		const source = blueLineSource(polygon, { type: "spacing", spacing: 1_000 }, 1);

		await expect(source.take(1)).rejects.toThrow("complete spacing plan");
	});

	it("passes cancellation through to tile requests", async () => {
		let fetchSignal!: AbortSignal;
		vi.stubGlobal(
			"fetch",
			vi.fn((_url: string, init: RequestInit) => {
				fetchSignal = init.signal!;
				return new Promise((_resolve, reject) => {
					fetchSignal.addEventListener("abort", () =>
						reject(new DOMException("Aborted", "AbortError")),
					);
				});
			}),
		);
		const source = blueLineSource(polygon, { type: "spacing", spacing: 1_000 }, 1);
		const pending = source.take(1);
		await vi.waitFor(() => expect(fetchSignal).toBeDefined());

		source.cancel();

		expect(fetchSignal.aborted).toBe(true);
		expect(await pending).toEqual([]);
	});
});
