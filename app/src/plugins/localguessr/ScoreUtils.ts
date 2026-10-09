import { formatDistance } from "@/lib/util/format";
import type { LatLng } from "@/types";
import { isWorldBounds, scoreTupleToBounds } from "@/types";
import { distMeters } from "@/lib/geo/geo";
import { resolveScoreMaxError, WORLD_MAX_ERROR } from "@/lib/geo/scoring";
import type { ScoreBounds } from "@/bindings.gen";

/**
 * Game score: 5000 * e^(-10 * distance / maxDistance).
 * Distance ≤ 25 m is a perfect 5000.
 * `maxDistance` is the score-bounds max-error distance (same units as
 * `resolveScoreMaxError` / GeoGuessr's maxErrorDistance).
 */
export function computeGameScore(distanceMeters: number, maxErrorDistance: number): number {
	if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return 0;
	if (distanceMeters <= 25) return 5000;
	const maxD = maxErrorDistance > 0 ? maxErrorDistance : WORLD_MAX_ERROR;
	// maxErrorDistance from scoring.ts is already a scaled "error distance"
	// comparable to GeoGuessr's MaxDistance. Convert meters → same unit space
	// used by the exponential: distanceKm relative to maxErrorDistance.
	// The project's resolveScoreMaxError returns values where world ≈ 185.35,
	// and distance is compared in meters via SCORE_BASE. Here the user asked
	// for 5000*e^(-10*Distance/MaxDistance) with Distance in the same units
	// as MaxDistance. We treat both in meters: MaxDistance = maxError * 1000
	// when maxError looks like the GeoGuessr km-scale constant, OR we use
	// maxErrorDistance directly as the scale for meters/1000.
	//
	// Align with GeoGuessr: MaxDistance is typically in metres for the formula
	// when using the simplified exp form. Convert our maxError (world≈185.35)
	// into metres via the same mapping as the legacy computeScore scale.
	const maxDistanceMeters = maxErrorToMeters(maxD);
	const raw = 5000 * Math.exp((-10 * distanceMeters) / maxDistanceMeters);
	return Math.max(0, Math.min(5000, Math.round(raw)));
}

/** Convert score-bounds max-error into a metre scale for the exp formula. */
function maxErrorToMeters(maxError: number): number {
	// World max-error ≈ 185.35 maps to ~20_000 km (half Earth circumference-ish
	// used by GeoGuessr world maps). Ratio ≈ 20000000 / 185.35 ≈ 107903.
	const WORLD_METERS = 20_000_000;
	return Math.max(25, (maxError / WORLD_MAX_ERROR) * WORLD_METERS);
}

export function distanceBetween(a: LatLng, b: LatLng): number {
	return distMeters(a, b);
}

export function scoreForGuess(
	guess: LatLng | null,
	truth: LatLng,
	maxErrorDistance: number,
): { distanceMeters: number | null; score: number } {
	if (!guess) return { distanceMeters: null, score: 0 };
	const distanceMeters = distMeters(guess, truth);
	return {
		distanceMeters,
		score: computeGameScore(distanceMeters, maxErrorDistance),
	};
}

/** Resolve max-error from the current map's scoreBounds + location seeds. */
export function resolveMapMaxError(
	scoreBounds: ScoreBounds | null | undefined,
	locations: LatLng[],
): number {
	const raw = scoreBounds ?? "auto";
	if (raw === "auto" || raw == null) {
		return resolveScoreMaxError("auto", locations);
	}
	if (raw === "world") {
		return WORLD_MAX_ERROR;
	}
	if (Array.isArray(raw)) {
		const bounds = scoreTupleToBounds(raw);
		return resolveScoreMaxError(isWorldBounds(bounds) ? bounds : bounds, locations);
	}
	return resolveScoreMaxError("auto", locations);
}

export { formatDistance, WORLD_MAX_ERROR };
