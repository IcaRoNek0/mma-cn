// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createLocation } from "@/types";
import { fallbackPanoramaMetadata } from "@/lib/pano/types";

const h = vi.hoisted(() => ({
	metadata: vi.fn(),
	nearest: vi.fn(),
	viewers: [] as { setPanorama: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[],
}));
vi.mock("@photo-sphere-viewer/core", () => ({
	events: { PositionUpdatedEvent: { type: "position" }, ZoomUpdatedEvent: { type: "zoom" } },
	Viewer: class {
		adapter = {
			queue: { tasks: {}, runningTasks: {}, concurency: 1 },
			state: { tileConfig: { level: 0 } },
		};
		setPanorama = vi.fn(async () => {});
		destroy = vi.fn();
		constructor() {
			h.viewers.push(this);
		}
		addEventListener() {}
		removeEventListener() {}
		setOption() {}
		zoom() {}
		getZoomLevel() {
			return 0;
		}
		getPosition() {
			return { yaw: 0, pitch: 0 };
		}
	},
}));
vi.mock("@photo-sphere-viewer/equirectangular-tiles-adapter", () => ({
	EquirectangularTilesAdapter: class {},
}));
vi.mock("@/store/useMapStore", () => ({}));
vi.mock("@/store/settings", () => ({
	getSettings: () => ({ panoRotateSensitivity: 1 }),
	normalizeInputSensitivity: () => 1,
}));
vi.mock("@/lib/events", () => ({ subscribe: () => () => {} }));
vi.mock("@/lib/pano/index", async (original) => ({
	...(await original<typeof import("@/lib/pano/index")>()),
	getPanoramaProvider: () => ({
		getMetadata: h.metadata,
		findNearest: h.nearest,
		getTileUrl: () => "https://example.invalid/tile",
	}),
}));
import { PsvPanoramaController } from "@/lib/sv/panoSingleton";
const row = (id: string | null) =>
	createLocation({ lat: 30, lng: 120, panoId: id, extra: { source: "qq_trekker" } });
const meta = (id: string) => fallbackPanoramaMetadata("qq_trekker", id, { lat: 30, lng: 120 });

it("an older metadata request cannot replace the new location", async () => {
	let finish!: (value: ReturnType<typeof meta>) => void;
	h.metadata
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		)
		.mockResolvedValueOnce(meta("new"));
	const controller = new PsvPanoramaController(document.createElement("div"));
	const old = controller.load(row("old"));
	await controller.load(row("new"));
	finish(meta("old"));
	await old;
	expect(controller.getMetadata()?.panoId).toBe("new");
	expect(h.viewers.at(-1)!.setPanorama).toHaveBeenCalledTimes(1);
	controller.destroy();
});

it("resolves a coordinates-only China location through its provider", async () => {
	h.nearest.mockResolvedValue({ panoId: "found" });
	h.metadata.mockResolvedValue(meta("found"));
	const controller = new PsvPanoramaController(document.createElement("div"));
	await controller.load(row(null));
	expect(controller.getMetadata()?.panoId).toBe("found");
	controller.destroy();
});

it("destroying a controller invalidates its pending load", async () => {
	let finish!: (value: ReturnType<typeof meta>) => void;
	h.metadata.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const controller = new PsvPanoramaController(document.createElement("div"));
	const pending = controller.load(row("old"));
	controller.destroy();
	finish(meta("old"));
	await pending;
	expect(h.viewers.at(-1)!.setPanorama).not.toHaveBeenCalled();
});
