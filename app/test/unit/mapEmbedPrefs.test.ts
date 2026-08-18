import { describe, it, expect } from "vitest";
import { cycleMarkerOpacity, DEFAULT_PREFS, toggledOpacity } from "@/store/mapEmbedPrefs";

it("keeps click-to-find enabled for existing users by default", () => {
	expect(DEFAULT_PREFS.findNearbyPanoOnClick).toBe(true);
});

describe("toggledOpacity", () => {
	it("hides a visible layer", () => {
		expect(toggledOpacity(0.5, 0.5, "previous")).toBe(0);
		expect(toggledOpacity(1, 1, "full")).toBe(0);
	});

	it("restores the last non-zero value", () => {
		expect(toggledOpacity(0, 0.35, "previous")).toBe(0.35);
	});

	it("restores full opacity when the setting says so", () => {
		expect(toggledOpacity(0, 0.35, "full")).toBe(1);
	});

	it("falls back to full opacity with no remembered value", () => {
		expect(toggledOpacity(0, 0, "previous")).toBe(1);
	});
});

describe("cycleMarkerOpacity", () => {
	it("cycles opaque, translucent, and hidden states", () => {
		expect(cycleMarkerOpacity(1)).toBe(0.35);
		expect(cycleMarkerOpacity(0.35)).toBe(0);
		expect(cycleMarkerOpacity(0)).toBe(1);
	});

	it("normalizes an arbitrary slider value to the opaque state", () => {
		expect(cycleMarkerOpacity(0.5)).toBe(1);
	});
});
