// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act } from "react";
import { mount } from "./fixtures/harness";
import { applySelectionUpdate, getMapState } from "@/store/useMapStore";
import { useSelectorPick, type SelectorPickController } from "@/store/selectorPick";
import { buildSelection, tagSelector, toggleGhost } from "@/store/selections";

vi.mock("@/lib/commands", async () => {
	const { selectionChange } = await import("./fixtures/mocks");
	return { cmd: { storeSyncSelections: vi.fn(async () => selectionChange()) } };
});

let result: SelectorPickController;
function Probe() {
	// eslint-disable-next-line react-hooks/globals -- renderHook-style probe
	result = useSelectorPick({ pick: "selection" });
	return null;
}

afterEach(() => {
	const s = getMapState() as Record<string, unknown>;
	s.map = null;
	s.selectionList = [];
});

describe("useSelectorPick", () => {
	it("follows the active selections when one is ghosted", async () => {
		const [a, b] = [1, 2].map((id) => buildSelection(tagSelector(id)));
		const s = getMapState() as Record<string, unknown>;
		s.map = { id: "test" };
		s.selectionList = [a, b].map((selection) => ({ selection, ghosted: false }));
		mount(createElement(Probe), { attach: false });
		expect(result.selector).toEqual({ type: "Union", selections: [a, b] });

		await act(() => applySelectionUpdate(toggleGhost(1)));

		expect(result.selector).toEqual({ type: "Union", selections: [a] });
	});
});
