import type { Layer } from "@deck.gl/core";
import SDFMarkerLayer from "@/lib/render/sdf-marker-layer/SDFMarkerLayer";
import type { MarkerStyle } from "@/types";
import type { CellManager } from "@/lib/render/CellManager";
import type { RGBA } from "@/lib/util/color";
import { translucentGroup } from "@/lib/render/translucentGroup";

/** Colour source for a marker layer. The base cells are all one colour and vary only in
 *  whether each marker is hidden, so they pass a constant plus a visibility byte; the
 *  selection overlay genuinely varies per marker and passes RGBA. */
export type MarkerColors =
	| { kind: "constant"; color: RGBA; visible: Uint8Array }
	| { kind: "perMarker"; colors: Uint8Array };

export type MarkerBuf = {
	positions: Float32Array;
	angles: Float32Array;
	color: MarkerColors;
};

/** Round each lat/lng to the same float precision. */
export function renderPos(lng: number, lat: number): [number, number] {
	return [Math.fround(lng), Math.fround(lat)];
}

export const MARKER_STYLE = {
	circle: { shape: "circle", radiusPixels: 6, angle: false },
	arrow: { shape: "arrow", radiusPixels: 12, angle: true },
	pin: { shape: "pin", radiusPixels: 16, angle: false },
} as const;

export function buildMarkerLayer(
	markerStyle: MarkerStyle,
	idBase: string,
	count: number,
	buf: MarkerBuf,
	colorVer: number,
	posVer: number,
	group: string | null,
	sizeScale = 1,
): Layer {
	const s = MARKER_STYLE[markerStyle];
	const attributes: Record<string, unknown> = {
		getPosition: { value: buf.positions, size: 2 },
	};
	const props: Record<string, unknown> = {};
	if (buf.color.kind === "constant") {
		props.getFillColor = buf.color.color;
		attributes.getVisible = { value: buf.color.visible, size: 1 };
	} else {
		attributes.getFillColor = { value: buf.color.colors, size: 4 };
	}
	if (s.angle) attributes.getAngle = { value: buf.angles, size: 1 };
	const LayerClass = SDFMarkerLayer as unknown as new (props: Record<string, unknown>) => Layer;
	return new LayerClass({
		id: idBase,
		data: { length: count, attributes },
		shape: s.shape,
		radiusPixels: s.radiusPixels * sizeScale,
		strokeWidthPixels: Math.min(2.25, Math.max(1.25, 1.5 * sizeScale)),
		pickable: true,
		...props,
		translucentGroup: group,
		updateTriggers: {
			getFillColor: [colorVer],
			getVisible: [colorVer],
			getPosition: [posVer],
			...(s.angle ? { getAngle: [posVer] } : {}),
		},
	});
}

// One marker layer per non-empty cell, drawn as one translucent group.
export function baseMarkerLayers(
	cm: CellManager,
	markerStyle: MarkerStyle,
	markerColor: RGBA,
	markerOpacity: number,
	markerSize = 1,
): Layer[] {
	return translucentGroup("cells", markerOpacity, (group) =>
		[...cm.cells]
			.filter(([, cell]) => cell.count > 0)
			.map(([cellKey, cell]) =>
				buildMarkerLayer(
					markerStyle,
					`cell:${cellKey}`,
					cell.count,
					{
						positions: cell.positions,
						angles: cell.angles,
						color: { kind: "constant", color: markerColor, visible: cell.visible },
					},
					cell.colorVersion,
					cell.positionVersion,
					group,
					markerSize,
				),
			),
	);
}

// Selected markers ride on top as their own pickable layer; otherwise clicks fall through to
// the cell layer where selected markers have no z-priority, and an overlapping neighbor gets
// picked instead of the marker on top.
export function selectedMarkerLayers(
	cm: CellManager,
	markerStyle: MarkerStyle,
	opacity: number,
	markerSize = 1,
): Layer[] {
	if (cm.overlay.count === 0) return [];
	return translucentGroup("selected", opacity, (group) => [
		buildMarkerLayer(
			markerStyle,
			"sel-overlay",
			cm.overlay.count,
			{
				positions: cm.overlay.positions,
				angles: cm.overlay.angles,
				color: { kind: "perMarker", colors: cm.overlay.colors },
			},
			cm.overlay.version,
			cm.overlay.version,
			group,
			markerSize,
		),
	]);
}
