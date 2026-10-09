import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { checkoutCommit, getMapState } from "@/store/useMapStore";
import type { ListedSelection } from "@/bindings.gen";
import { cmd } from "@/lib/commands";

vi.mock("@/store/mapList", () => ({
	setCachedMapList: vi.fn(),
	invalidateMapList: vi.fn(async () => {}),
	reloadMapList: vi.fn(async () => {}),
}));

vi.mock("@/lib/commands", async () => {
	const { selectionChange } = await import("./fixtures/mocks");
	return {
		cmd: {
			storeSaveDirty: vi.fn(async () => {}),
			storeCloseMap: vi.fn(async () => {}),
			storeCheckoutCommit: vi.fn(async () => {}),
			storeOpenMap: vi.fn(async () => ({})),
			storeSyncSelections: vi.fn(async () => selectionChange()),
		},
	};
});

const fakeRow = (key: string): ListedSelection => ({
	selection: { key, color: [0, 0, 0], selector: { type: "Everything" } },
	ghosted: false,
});

beforeEach(() => {
	const s = getMapState() as Record<string, unknown>;
	s.mapId = "test";
	s.map = { id: "test" };
	s.selectionList = [fakeRow("tag:1")];
});

afterEach(() => {
	const s = getMapState() as Record<string, unknown>;
	s.mapId = null;
	s.map = null;
	s.selectionList = [];
	vi.clearAllMocks();
});

describe("checkoutCommit failure", () => {
	it("pushes the listed selections back into the reopened store", async () => {
		vi.mocked(cmd.storeCheckoutCommit).mockRejectedValueOnce(new Error("open elsewhere"));
		await expect(checkoutCommit("abc1234")).rejects.toThrow("open elsewhere");
		expect(cmd.storeOpenMap).toHaveBeenCalled();
		expect(cmd.storeSyncSelections).toHaveBeenCalledWith([
			expect.objectContaining({ selection: expect.objectContaining({ key: "tag:1" }) }),
		]);
		expect(getMapState().selectionList.map((r) => r.selection.key)).toEqual(["tag:1"]);
	});

	it("still surfaces the checkout error when the resync fails too", async () => {
		vi.mocked(cmd.storeCheckoutCommit).mockRejectedValueOnce(new Error("bad commit"));
		vi.mocked(cmd.storeSyncSelections).mockRejectedValueOnce(new Error("no store"));
		await expect(checkoutCommit("abc1234")).rejects.toThrow("bad commit");
	});
});
