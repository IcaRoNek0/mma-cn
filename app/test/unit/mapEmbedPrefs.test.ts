import { describe, it, expect } from "vitest";
import {
	DEFAULT_PREFS,
	layerOpacity,
	toggledLayer,
	type OpacityLayer,
} from "@/store/mapEmbedPrefs";
import { migrationsFor } from "@/store/migrations";

describe("layer opacity", () => {
	it("gates each layer's opacity on its own visibility", () => {
		const prefs = { ...DEFAULT_PREFS, svOpacity: 0.5, markerOpacity: 0.4, selectedOpacity: 0.3 };
		const layers: OpacityLayer[] = ["sv", "marker", "selected"];
		for (const layer of layers) {
			expect(layerOpacity(prefs, layer)).toBe(prefs[`${layer}Opacity`]);
			const hidden = { ...prefs, [`${layer}Visible`]: false };
			for (const other of layers) {
				expect(layerOpacity(hidden, other)).toBe(other === layer ? 0 : prefs[`${other}Opacity`]);
			}
		}
	});
});

describe("toggledLayer", () => {
	it("hides a visible layer without losing its opacity", () => {
		expect(toggledLayer(0.35, true, "previous")).toEqual({ opacity: 0.35, visible: false });
		expect(toggledLayer(0.35, true, "full")).toEqual({ opacity: 0.35, visible: false });
	});

	it("restores the hidden layer at its own opacity", () => {
		expect(toggledLayer(0.35, false, "previous")).toEqual({ opacity: 0.35, visible: true });
	});

	it("restores full opacity when the setting says so", () => {
		expect(toggledLayer(0.35, false, "full")).toEqual({ opacity: 1, visible: true });
	});

	it("survives a hide/show round trip at any opacity", () => {
		for (const opacity of [0.05, 0.35, 1]) {
			const hidden = toggledLayer(opacity, true, "previous");
			expect(toggledLayer(hidden.opacity, hidden.visible, "previous")).toEqual({
				opacity,
				visible: true,
			});
		}
	});
});

describe("mapEmbedPrefs migration", () => {
	const migrate = (stored: Record<string, unknown>) => {
		for (const m of migrationsFor("mapEmbedPrefs")) m(stored);
		return stored;
	};

	// Literals on purpose: the migration names historical shapes, not live defaults.
	it("turns a persisted zero opacity into a hidden layer at the default opacity", () => {
		expect(migrate({ svOpacity: 0, markerOpacity: 0 })).toEqual({
			svOpacity: 0.5,
			svVisible: false,
			markerOpacity: 1,
			markerVisible: false,
		});
	});

	it("leaves visible layers alone and is idempotent", () => {
		const once = migrate({ svOpacity: 0.35, markerOpacity: 0 });
		expect(migrate({ ...once })).toEqual(once);
		expect(once.svOpacity).toBe(0.35);
		expect(once.svVisible).toBeUndefined();
	});
});
