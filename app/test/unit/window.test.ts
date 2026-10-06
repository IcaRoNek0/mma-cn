// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
	WINDOWS,
	labelOf,
	identityOf,
	hashOf,
	identityFromHash,
	titleOf,
	appWindow,
	saveWindowState,
	type WindowIdentity,
} from "@/lib/window";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => {} }));

const list: WindowIdentity = { type: "list" };
const editor: WindowIdentity = { type: "editor", mapId: "abc-123" };

describe("window codecs", () => {
	it("label round-trips for every window type", () => {
		for (const w of [list, editor]) expect(identityOf(labelOf(w))).toEqual(w);
		expect(labelOf(list)).toBe("main");
		expect(labelOf(editor)).toBe("map-abc-123");
	});

	it("an unknown or empty label is nobody's window", () => {
		expect(identityOf("settings")).toBeNull();
		expect(identityOf("map-")).toBeNull();
	});

	it("hash round-trips and leaves the overlay segments to the caller", () => {
		for (const w of [list, editor]) {
			const hash = `#${[...hashOf(w), "manual", "ch"].join("/")}`;
			expect(identityFromHash(hash)).toEqual({ window: w, rest: ["manual", "ch"] });
		}
		expect(identityFromHash("")).toEqual({ window: list, rest: [] });
		expect(identityFromHash("#map")).toEqual({ window: list, rest: ["map"] });
	});

	it("the list window is the fallback, so it is declared last", () => {
		expect(Object.keys(WINDOWS).at(-1)).toBe("list");
	});

	it("titles follow the open map, and an editor without one names itself", () => {
		expect(titleOf(list, null)).toBe("Map Making App");
		expect(titleOf(list, "Japan")).toBe("Japan · Map Making App");
		expect(titleOf(editor, "Japan")).toBe("Japan · Map Making App");
		expect(titleOf(editor, null)).not.toBe(titleOf(list, null));
	});
});

describe("saveWindowState", () => {
	const key = `win-maximized:${appWindow.label}`;
	const setWindow = (maximized: boolean, minimized: boolean) =>
		Object.assign(appWindow, {
			isMaximized: async () => maximized,
			isMinimized: async () => minimized,
		});

	it("a minimized window keeps the maximized bit it had while visible", async () => {
		setWindow(true, false);
		await saveWindowState();
		expect(localStorage.getItem(key)).toBe("true");
		setWindow(false, true);
		await saveWindowState();
		expect(localStorage.getItem(key)).toBe("true");
		setWindow(false, false);
		await saveWindowState();
		expect(localStorage.getItem(key)).toBe("false");
	});
});
