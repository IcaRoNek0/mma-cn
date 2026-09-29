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
import type { MarkerStyle } from "@/types";

const buf: MarkerBuf = {
	positions: new Float32Array([0, 0]),
	angles: new Float32Array([0]),
	color: { kind: "perMarker", colors: new Uint8Array([255, 0, 0, 255]) },
};

function build(style: MarkerStyle, opacity: number) {
	return buildMarkerLayer(style, "t", 1, buf, 0, 0, opacity) as unknown as {
		constructor: unknown;
		selector: Record<string, unknown>;
		props: Record<string, unknown>;
	};
}

describe("marker layer flattening (layer-level opacity)", () => {
	it("translucent markers flatten: premultiply uniform + constant-alpha blend", () => {
		const layer = build("pin", 0.5);
		const expected = Math.pow(0.5, 1 / 2.2);
		expect(layer.props.flattenOpacity).toBeCloseTo(expected);
		expect(layer.props.opacity).toBe(1);
		const params = layer.props.parameters as Record<string, unknown>;
		expect(params.blendAlphaSrcFactor).toBe("constant");
		expect((params.blendColor as number[])[3]).toBeCloseTo(expected);
	});

	it("full opacity renders without flattening", () => {
		const layer = build("pin", 1);
		expect(layer.props.flattenOpacity).toBe(0);
		expect(layer.props.parameters).toEqual({});
	});

	it("every marker style uses the SDF layer with its style shape", () => {
		for (const style of Object.keys(MARKER_STYLE) as MarkerStyle[]) {
			for (const opacity of [0.5, 1]) {
				const layer = build(style, opacity);
				expect(layer).toBeInstanceOf(SDFMarkerLayer);
				expect(layer.props.shape).toBe(MARKER_STYLE[style].shape);
				expect(layer.props.radiusPixels).toBeCloseTo(MARKER_STYLE[style].radiusPixels);
			}
		}
	});
});

describe("selected marker layer", () => {
	const seeded = () => {
		const cm = new CellManager();
		cm.applyDelta(
			delta({
				added: [entry("s", 1, 10, 20, 0, paint([255, 0, 0])), entry("s", 2, 30, 40)],
			}),
		);
		return cm;
	};

	it("draws the selected markers at their own opacity, independent of the rest", () => {
		const cm = seeded();
		const [layer] = selectedMarkerLayers(cm, "pin", 0.5) as unknown as {
			props: Record<string, unknown>;
		}[];
		expect(layer.props.flattenOpacity).toBeCloseTo(Math.pow(0.5, 1 / 2.2));
		expect(baseMarkerLayers(cm, "pin", [0, 0, 0, 255], 0)).toEqual([]);
	});

	it("draws nothing when hidden, even with unselected markers showing", () => {
		const cm = seeded();
		expect(selectedMarkerLayers(cm, "pin", 0)).toEqual([]);
		expect(baseMarkerLayers(cm, "pin", [0, 0, 0, 255], 1)).toHaveLength(1);
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
