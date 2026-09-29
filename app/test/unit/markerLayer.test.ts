import { describe, it, expect } from "vitest";
import {
	baseMarkerLayers,
	buildMarkerLayer,
	MARKER_STYLE,
	renderPos,
	selectedMarkerLayers,
	type MarkerBuf,
} from "@/lib/render/markerLayer";
import { CellManager } from "@/lib/render/CellManager";
import { delta, entry, paint } from "./fixtures/renderFixtures";
import SDFMarkerLayer from "@/lib/render/sdf-marker-layer/SDFMarkerLayer";
import { TranslucentGroupLayer } from "@/lib/render/translucentGroup";
import type { MarkerStyle } from "@/types";

const buf: MarkerBuf = {
	positions: new Float32Array([0, 0]),
	angles: new Float32Array([0]),
	color: { kind: "perMarker", colors: new Uint8Array([255, 0, 0, 255]) },
};

type Built = { props: Record<string, unknown> };

function build(style: MarkerStyle, group: string | null) {
	return buildMarkerLayer(style, "t", 1, buf, 0, 0, group) as unknown as Built;
}

const seeded = () => {
	const cm = new CellManager();
	cm.applyDelta(
		delta({
			added: [
				entry("a", 1, 10, 20, 0, paint([255, 0, 0])),
				entry("a", 2, 30, 40),
				entry("b", 3, 50, 60),
			],
		}),
	);
	return cm;
};

const base = (cm: CellManager, opacity: number) =>
	baseMarkerLayers(cm, "pin", [0, 0, 0, 255], opacity) as unknown as Built[];
const selected = (cm: CellManager, opacity: number) =>
	selectedMarkerLayers(cm, "pin", opacity) as unknown as Built[];

describe("marker layer", () => {
	it("every marker style uses the SDF layer with its style shape", () => {
		for (const style of Object.keys(MARKER_STYLE) as MarkerStyle[]) {
			for (const group of [null, "g"]) {
				const layer = build(style, group);
				expect(layer).toBeInstanceOf(SDFMarkerLayer);
				expect(layer.props.shape).toBe(MARKER_STYLE[style].shape);
				expect(layer.props.radiusPixels).toBeCloseTo(MARKER_STYLE[style].radiusPixels);
				expect(layer.props.translucentGroup).toBe(group);
			}
		}
	});
});

describe("translucent marker groups", () => {
	it("draws every cell into one group, laid onto the map once after the last cell", () => {
		const layers = base(seeded(), 0.5);
		const cells = layers.slice(0, -1);
		expect(cells).toHaveLength(2);
		for (const cell of cells) expect(cell.props.translucentGroup).toBe("cells");
		const sheet = layers.at(-1)!;
		expect(sheet).toBeInstanceOf(TranslucentGroupLayer);
		expect(sheet.props).toMatchObject({ group: "cells", opacity: 0.5, pickable: false });
	});

	it("draws opaque markers straight onto the map", () => {
		const layers = [...base(seeded(), 1), ...selected(seeded(), 1)];
		expect(layers).toHaveLength(3);
		for (const layer of layers) {
			expect(layer).not.toBeInstanceOf(TranslucentGroupLayer);
			expect(layer.props.translucentGroup).toBeNull();
		}
	});

	it("keeps selected markers in their own group at their own opacity", () => {
		const cm = seeded();
		const [member, sheet] = selected(cm, 0.3);
		expect(member.props.translucentGroup).toBe("selected");
		expect(sheet.props).toMatchObject({ group: "selected", opacity: 0.3 });
		expect(base(cm, 0)).toEqual([]);
	});

	it("draws nothing for a hidden group, whatever the other shows", () => {
		const cm = seeded();
		expect(selected(cm, 0)).toEqual([]);
		expect(base(cm, 1)).toHaveLength(2);
	});
});

describe("renderPos", () => {
	// The bug it exists to prevent: an accessor-fed layer drew the active marker at the full
	// f64 coordinate while its base marker sat at the f32 the cell buffer holds, leaving the
	// two up to ~0.9m apart at high zoom (issue #212).
	it("lands on the same value the f32 cell buffer holds", () => {
		for (const [lng, lat] of [
			[151.2093, -33.8688],
			[-157.8583, 21.3069],
			[2.3522, 48.8566],
			[0, 0],
		]) {
			const cell = new Float32Array([lng, lat]);
			expect(renderPos(lng, lat)).toEqual([cell[0], cell[1]]);
		}
	});
});
