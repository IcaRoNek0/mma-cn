import { cmd } from "@/lib/commands";
import {
	resolveCountryName,
	type GeocodeBackend,
	type RoundResult,
	type StreakMode,
} from "./GameState";

export interface PlaceInfo {
	countryCode: string | null;
	countryName: string | null;
	admin: string | null;
	city: string | null;
}

async function geocodeLocal(lat: number, lng: number, locale?: string): Promise<PlaceInfo | null> {
	const result = await cmd.reverseGeocode(lat, lng, null);
	if (!result) return null;
	return enrichPlace(
		{
			countryCode: result.country_code?.toUpperCase() ?? null,
			countryName: result.country || null,
			admin: result.admin || null,
			city: result.city || null,
		},
		locale,
	);
}

async function geocodeNominatim(
	lat: number,
	lng: number,
	locale?: string,
): Promise<PlaceInfo | null> {
	const url = new URL("https://nominatim.openstreetmap.org/reverse");
	url.searchParams.set("lat", String(lat));
	url.searchParams.set("lon", String(lng));
	url.searchParams.set("format", "json");
	url.searchParams.set("zoom", "10");
	url.searchParams.set("addressdetails", "1");
	const res = await fetch(url.toString(), {
		headers: { "Accept-Language": "en", "User-Agent": "MMA-localguessr/1.0" },
	});
	if (!res.ok) return null;
	const data = await res.json();
	if (!data?.address) return null;
	const a = data.address;
	return enrichPlace(
		{
			countryCode: (a.country_code as string)?.toUpperCase() ?? null,
			countryName: (a.country as string) ?? null,
			admin: (a.state as string) || (a.province as string) || (a.region as string) || null,
			city: (a.city as string) || (a.town as string) || (a.village as string) || null,
		},
		locale,
	);
}

function enrichPlace(place: PlaceInfo, locale?: string): PlaceInfo {
	const countryName = resolveCountryName(place.countryCode, place.countryName, locale);
	return { ...place, countryName };
}

export async function reverseGeocodePlace(
	lat: number,
	lng: number,
	backend: GeocodeBackend = "local",
	locale?: string,
): Promise<PlaceInfo | null> {
	try {
		if (backend === "nominatim") return await geocodeNominatim(lat, lng, locale);
		return await geocodeLocal(lat, lng, locale);
	} catch {
		return null;
	}
}

/** Compare two place strings case-insensitively; empty/null never matches. */
function placeEq(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) return false;
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Internal country/state hit checks (both computed; caller picks by streak mode).
 */
export function checkStreakHit(
	mode: StreakMode,
	truth: PlaceInfo | null,
	guess: PlaceInfo | null,
): { country: boolean | null; state: boolean | null } {
	if (mode === "off") return { country: null, state: null };
	if (!truth || !guess) return { country: false, state: false };

	const countryHit: boolean =
		truth.countryCode && guess.countryCode
			? truth.countryCode === guess.countryCode
			: placeEq(truth.countryName, guess.countryName);

	const sameCountry =
		(truth.countryCode && guess.countryCode && truth.countryCode === guess.countryCode) ||
		placeEq(truth.countryName, guess.countryName);
	const stateHit: boolean = sameCountry && placeEq(truth.admin, guess.admin);

	return { country: countryHit, state: stateHit };
}

/** Compute consecutive streak length from the start of a rounds array. */
export function computeStreakLength(rounds: RoundResult[]): number {
	let n = 0;
	for (const r of rounds) {
		if (r.streakHit) n++;
		else break;
	}
	return n;
}

/** Longest consecutive streakHit run in the rounds list. */
export function computeBestStreak(rounds: RoundResult[]): number {
	return computeBestStreakForMode(rounds, "country");
}

/** Longest consecutive streak run for the active streak mode. */
export function computeBestStreakForMode(rounds: RoundResult[], mode: StreakMode): number {
	if (mode === "off") return 0;
	const useState = mode === "state";
	let best = 0;
	let cur = 0;
	for (const r of rounds) {
		const hit = useState ? r.stateStreakHit : r.streakHit;
		if (hit) {
			cur++;
			best = Math.max(best, cur);
		} else {
			cur = 0;
		}
	}
	return best;
}
