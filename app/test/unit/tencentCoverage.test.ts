import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	isCached: vi.fn(),
	prepare: vi.fn(),
	read: vi.fn(),
}));

vi.mock("@/lib/commands", () => ({
	cmd: {
		tencentCoverageIsCached: mocks.isCached,
		tencentCoveragePrepare: mocks.prepare,
		tencentCoverageRead: mocks.read,
	},
}));

vi.mock("@/lib/util/log", () => ({
	log: { warn: vi.fn() },
}));

import {
	CachedTencentCoverageSource,
	TENCENT_COVERAGE_ARCHIVE_KEY,
} from "@/lib/map/tencentCoverage";

beforeEach(() => {
	vi.restoreAllMocks();
	mocks.isCached.mockReset();
	mocks.prepare.mockReset();
	mocks.read.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("Tencent coverage cache source", () => {
	it("reads PMTiles ranges from disk when the cache is ready", async () => {
		mocks.isCached.mockResolvedValue(true);
		mocks.read.mockResolvedValue([1, 2, 255]);
		const source = new CachedTencentCoverageSource("https://example.test/lines.pmtiles");

		const response = await source.getBytes(20, 3);

		expect(source.getKey()).toBe(TENCENT_COVERAGE_ARCHIVE_KEY);
		expect(mocks.read).toHaveBeenCalledWith(20, 3);
		expect([...new Uint8Array(response.data)]).toEqual([1, 2, 255]);
	});

	it("starts a background download while serving the first range remotely", async () => {
		mocks.isCached.mockResolvedValue(false);
		mocks.prepare.mockReturnValue(new Promise(() => {}));
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(new Uint8Array([7, 8, 9]), {
						status: 206,
						headers: { "Content-Length": "3" },
					}),
			),
		);
		const source = new CachedTencentCoverageSource("https://example.test/lines.pmtiles");

		const response = await source.getBytes(0, 3);

		expect(mocks.prepare).toHaveBeenCalledOnce();
		expect([...new Uint8Array(response.data)]).toEqual([7, 8, 9]);
	});
});
