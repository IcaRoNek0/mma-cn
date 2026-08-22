import { IconLayer, PathLayer } from "@deck.gl/layers";
import type { LatLng } from "@/types";

function svgDataUrl(svg: string): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Classic map pin — tip at bottom center (48×64). */
const PIN_W = 48;
const PIN_H = 64;
const PIN_ANCHOR_X = PIN_W / 2;
const PIN_ANCHOR_Y = PIN_H;

/** Player guess — red pin with hollow center. */
export const GUESS_PIN_URL =
	svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_W}" height="${PIN_H}" viewBox="0 0 48 64">
  <path fill="#D32F2F" stroke="#8B0000" stroke-width="1.5" d="M24 2C13.5 2 5 10.8 5 21.5 5 38 24 62 24 62s19-24 19-40.5C43 10.8 34.5 2 24 2z"/>
  <circle cx="24" cy="21" r="9" fill="#fff"/>
  <circle cx="24" cy="21" r="5" fill="#D32F2F"/>
</svg>`);

/** Correct location — green pin with check. */
export const TRUTH_PIN_URL =
	svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_W}" height="${PIN_H}" viewBox="0 0 48 64">
	<path fill="#2E7D32" stroke="#1B5E20" stroke-width="1.5" d="M24 2C13.5 2 5 10.8 5 21.5 5 38 24 62 24 62s19-24 19-40.5C43 10.8 34.5 2 24 2z"/>
	<circle cx="24" cy="21" r="9" fill="#fff"/>
	<path d="M20 21l3 3 6-6" stroke="#2E7D32" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`);

/** Stable icon defs — same object identity avoids icon reload by deck.gl on every render. */
const GUESS_ICON = {
	url: GUESS_PIN_URL,
	width: PIN_W,
	height: PIN_H,
	anchorX: PIN_ANCHOR_X,
	anchorY: PIN_ANCHOR_Y,
	mask: false,
};

const TRUTH_ICON = {
	url: TRUTH_PIN_URL,
	width: PIN_W,
	height: PIN_H,
	anchorX: PIN_ANCHOR_X,
	anchorY: PIN_ANCHOR_Y,
	mask: false,
};

/** Dash/gap relative to path width. With widthUnits:"pixels" and getWidth:2 this is
 * ~8px dash / ~6px gap on screen — GPU-evaluated, so density stays constant across
 * zoom without rebuilding geometry (see PathStyleExtension docs). */
const LINE_WIDTH_PX = 2;

/** One shared extension instance — recreating it every setProps forces shader recompiles. */

function pinIconLayer(
	id: string,
	points: LatLng[],
	icon: typeof GUESS_ICON,
	sizePx: number,
	pickable = false,
) {
	if (points.length === 0) return null;
	return new IconLayer({
		id,
		data: points,
		getPosition: (d: LatLng) => [d.lng, d.lat],
		getIcon: () => icon,
		getSize: sizePx,
		sizeUnits: "pixels",
		sizeMinPixels: sizePx,
		sizeMaxPixels: sizePx,
		billboard: true,
		pickable,
		alphaCutoff: 0.05,
		parameters: { depthTest: false },
		updateTriggers: {
			getIcon: [icon.url],
			getSize: [sizePx],
		},
	});
}

/** Batched guess pins — one IconLayer for all points (mirrors app: few layers, many instances). */
export function createGuessPinsLayer(id: string, points: LatLng[], sizePx = 36) {
	return pinIconLayer(id, points, GUESS_ICON, sizePx, false);
}

/** Batched truth / answer pins. When `pickable`, clicks open Street View (handled by the overlay). */
export function createTruthPinsLayer(
	id: string,
	points: LatLng[],
	sizePx = 36,
	opts: { pickable?: boolean } = {},
) {
	return pinIconLayer(id, points, TRUTH_ICON, sizePx, opts.pickable ?? false);
}

/** Convenience for a single pin. */
export function createGuessPinLayer(id: string, point: LatLng, sizePx = 36) {
	return createGuessPinsLayer(id, [point], sizePx);
}

export function createTruthPinLayer(
	id: string,
	point: LatLng,
	sizePx = 36,
	opts: { pickable?: boolean } = {},
) {
	return createTruthPinsLayer(id, [point], sizePx, opts);
}

export type ResultLinePair = { guess: LatLng; truth: LatLng };

/**
 * One PathLayer for all guess→truth connectors. Dashes are rendered by
 * PathStyleExtension in screen space (relative to pixel width), so zoom/pan
 * never needs to rebuild the layer — matching the app's "rebuild on data, not
 * zoom" pattern from buildSceneLayers / useMapSurface.
 */
export function createResultLinesLayer(id: string, pairs: ResultLinePair[]) {
	if (pairs.length === 0) return null;
	return new PathLayer({
		id,
		data: pairs,
		getPath: (d: ResultLinePair) => [
			[d.guess.lng, d.guess.lat],
			[d.truth.lng, d.truth.lat],
		],
		getColor: [0, 0, 0, 220],
		getWidth: LINE_WIDTH_PX,
		widthUnits: "pixels",
		capRounded: true,
		jointRounded: true,
		pickable: false,
		parameters: { depthTest: false },
		// Dashed paths are unavailable in the minimal deck.gl dependency set.
	});
}

/** Convenience for a single connector. */
export function createResultLineLayer(
	guess: LatLng,
	truth: LatLng,
	opts: { layerId?: string } = {},
) {
	return createResultLinesLayer(opts.layerId ?? "gg-result-line", [{ guess, truth }]);
}
