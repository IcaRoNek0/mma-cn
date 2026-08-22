import type { PickingInfo } from "@deck.gl/core";
import type { LatLng } from "@/types";
import type { DeckOverlayHandle, MapHost } from "@/lib/map/host";
import type { RoundLocation, RoundResult } from "./GameState";
import {
	createGuessPinLayer,
	createGuessPinsLayer,
	createResultLineLayer,
	createResultLinesLayer,
	createTruthPinLayer,
	createTruthPinsLayer,
	type ResultLinePair,
} from "./guessMapLayers";
import { openStreetViewInBrowser } from "./streetViewLink";

/** Truth pin layer id prefix — overlay click handlers key off this. */
export const TRUTH_LAYER_ID_PREFIX = "gg-truth";

function isTruthLayer(info: PickingInfo): boolean {
	const id = info.layer?.id ?? "";
	return id.startsWith(TRUTH_LAYER_ID_PREFIX) || id.includes("-truth");
}

/** Open Street View when a pickable truth / answer pin is clicked. */
export function handleTruthPinClick(info: PickingInfo): boolean {
	if (!info.picked || !isTruthLayer(info)) return false;
	const obj = info.object as RoundLocation | null | undefined;
	if (!obj || typeof obj.lat !== "number" || typeof obj.lng !== "number") return false;
	if (!("id" in obj)) return false;
	void openStreetViewInBrowser(obj);
	return true;
}

export function truthPinHoverCursor(info: PickingInfo): "pointer" | null {
	return info.picked && isTruthLayer(info) ? "pointer" : null;
}

/** Round-settlement layers: guess pin, answer pin (clickable), connector. */
export function buildRoundResultLayers(opts: {
	guess: LatLng | null;
	truth: RoundLocation | null;
}): // eslint-disable-next-line @typescript-eslint/no-explicit-any
any[] {
	const { guess, truth } = opts;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const layers: any[] = [];
	if (truth && guess) {
		const line = createResultLineLayer(guess, { lat: truth.lat, lng: truth.lng });
		if (line) layers.push(line);
	}
	if (guess) {
		const pin = createGuessPinLayer("gg-guess-pin", guess);
		if (pin) layers.push(pin);
	}
	if (truth) {
		const pin = createTruthPinLayer(`${TRUTH_LAYER_ID_PREFIX}-pin`, truth, 36, {
			pickable: true,
		});
		if (pin) layers.push(pin);
	}
	return layers;
}

/** Fit the host camera to guess + answer (or answer alone). */
export function fitRoundResultCamera(
	host: MapHost,
	guess: LatLng | null,
	truth: RoundLocation,
): void {
	if (guess) {
		host.fitBounds(
			{
				south: Math.min(guess.lat, truth.lat),
				west: Math.min(guess.lng, truth.lng),
				north: Math.max(guess.lat, truth.lat),
				east: Math.max(guess.lng, truth.lng),
			},
			60,
		);
	} else {
		host.moveCamera({ center: { lat: truth.lat, lng: truth.lng }, zoom: 10 });
	}
}

/** Apply result layers + truth-pin click/hover to a deck overlay (round settlement). */
export function applyRoundResultOverlay(
	overlay: DeckOverlayHandle,
	host: MapHost | null,
	opts: {
		guess: LatLng | null;
		truth: RoundLocation | null;
		idleCursor?: string | null;
	},
): void {
	const layers = buildRoundResultLayers(opts);
	overlay.setProps({
		layers,
		onClick: (info) => {
			handleTruthPinClick(info);
		},
		onHover: (info) => {
			const tip = truthPinHoverCursor(info);
			host?.setCursor(tip ?? opts.idleCursor ?? null);
		},
	});
}

/** Summary / replay layers for one or many rounds. */
export function buildReplayResultLayers(
	rounds: RoundResult[],
	opts: { pinSize?: number } = {},
): // eslint-disable-next-line @typescript-eslint/no-explicit-any
any[] {
	const pinSize = opts.pinSize ?? 28;
	const lines: ResultLinePair[] = [];
	const guesses: LatLng[] = [];
	const truths: RoundLocation[] = [];
	for (const r of rounds) {
		truths.push(r.location);
		if (r.guess) {
			guesses.push(r.guess);
			lines.push({
				guess: r.guess,
				truth: { lat: r.location.lat, lng: r.location.lng },
			});
		}
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const layers: any[] = [];
	const lineLayer = createResultLinesLayer("gg-replay-lines", lines);
	if (lineLayer) layers.push(lineLayer);
	const guessLayer = createGuessPinsLayer("gg-replay-guesses", guesses, pinSize);
	if (guessLayer) layers.push(guessLayer);
	const truthLayer = createTruthPinsLayer(`${TRUTH_LAYER_ID_PREFIX}-replay`, truths, pinSize, {
		pickable: true,
	});
	if (truthLayer) layers.push(truthLayer);
	return layers;
}

/** Apply replay layers + truth-pin click/hover (summary map). */
export function applyReplayResultOverlay(
	overlay: DeckOverlayHandle,
	host: MapHost | null,
	rounds: RoundResult[],
	opts: { pinSize?: number } = {},
): void {
	overlay.setProps({
		layers: buildReplayResultLayers(rounds, opts),
		onClick: (info) => {
			handleTruthPinClick(info);
		},
		onHover: (info) => {
			host?.setCursor(truthPinHoverCursor(info));
		},
	});
}
