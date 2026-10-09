import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/map/coverageDebug", () => ({ coverageError: vi.fn() }));
vi.mock("@/lib/util/util", () => ({ schemeBase: (scheme: string) => `${scheme}://` }));
import {
	BundledTencentCoverageSource,
	TENCENT_COVERAGE_ARCHIVE_URL,
} from "@/lib/map/tencentCoverage";
afterEach(() => vi.unstubAllGlobals());
describe("bundled Tencent coverage", () => {
	it("requests the exact archive byte range and forwards cancellation", async () => {
		const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 255])));
		vi.stubGlobal("fetch", fetcher);
		const signal = new AbortController().signal;
		const source = new BundledTencentCoverageSource();
		const result = await source.getBytes(20, 3, signal);
		expect(source.getKey()).toBe(TENCENT_COVERAGE_ARCHIVE_URL);
		expect(fetcher).toHaveBeenCalledWith(`${TENCENT_COVERAGE_ARCHIVE_URL}?offset=20&length=3`, {
			signal,
		});
		expect([...new Uint8Array(result.data)]).toEqual([1, 2, 255]);
	});
	it("rejects a truncated archive response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(new Uint8Array([1]))),
		);
		await expect(new BundledTencentCoverageSource().getBytes(0, 3)).rejects.toThrow("expected 3");
	});
	it("rejects backend range errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("invalid range", { status: 416 })),
		);
		await expect(new BundledTencentCoverageSource().getBytes(0, 3)).rejects.toThrow("HTTP 416");
	});
});
