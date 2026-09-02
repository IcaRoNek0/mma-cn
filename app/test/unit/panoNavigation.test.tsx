// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const pano = vi.hoisted(() => ({
	move: vi.fn(async () => true),
	setPano: vi.fn(),
	setPov: vi.fn(),
	getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
	getLinks: () => [{ heading: 10, pano: "next" }],
}));
vi.mock("@/lib/sv/panoSingleton", () => ({ singletonPano: pano }));

import { usePanoNavigation } from "@/components/editor/location/usePanoNavigation";
import { getSettings, type MovementMode } from "@/store/settings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function Harness({ mode }: { mode: MovementMode }) {
	usePanoNavigation({ ...getSettings(), defaultMovementMode: mode });
	return null;
}

function mount(mode: MovementMode) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => root.render(<Harness mode={mode} />));
	return () => {
		act(() => root.unmount());
		container.remove();
	};
}

const press = (key: string, init: KeyboardEventInit = {}) =>
	document.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true, ...init }));

const waitFrames = async (n: number) => {
	await act(async () => {
		for (let i = 0; i < n; i++) {
			await new Promise((r) => requestAnimationFrame(r));
		}
	});
};

beforeEach(() => {
	pano.move.mockClear();
	pano.setPano.mockClear();
	pano.setPov.mockClear();
});

describe("usePanoNavigation movement-mode gates", () => {
	it("move hotkey navigates in moving mode", () => {
		const unmount = mount("moving");
		press("ArrowUp", { shiftKey: true });
		expect(pano.move).toHaveBeenCalledWith("forward");
		unmount();
	});

	it("move hotkey is a no-op in no-move mode", () => {
		const unmount = mount("no-move");
		press("ArrowUp", { shiftKey: true });
		expect(pano.move).not.toHaveBeenCalled();
		unmount();
	});

	it("move hotkey is a no-op in nmpz mode", () => {
		const unmount = mount("nmpz");
		press("ArrowUp", { shiftKey: true });
		expect(pano.move).not.toHaveBeenCalled();
		unmount();
	});

	it("look hotkey pans in no-move mode", async () => {
		const unmount = mount("no-move");
		press("ArrowLeft");
		await waitFrames(2);
		expect(pano.setPov).toHaveBeenCalled();
		unmount();
	});

	it("look hotkey is a no-op in nmpz mode", async () => {
		const unmount = mount("nmpz");
		press("ArrowLeft");
		await waitFrames(2);
		expect(pano.setPov).not.toHaveBeenCalled();
		unmount();
	});
});
