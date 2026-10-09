import { open } from "@tauri-apps/plugin-shell";
import { mapsPanoUrl } from "@/lib/sv/mapsLink";
import type { RoundLocation } from "./GameState";

/** Build a browser Street View URL for a round location. */
export function buildStreetViewUrl(loc: RoundLocation): string | null {
	if (!loc.panoId) return null;
	return mapsPanoUrl({
		lat: loc.lat,
		lng: loc.lng,
		heading: loc.heading ?? 0,
		pitch: loc.pitch ?? 0,
		zoom: loc.zoom ?? 1,
		panoId: loc.panoId,
	}).toString();
}

export async function openStreetViewInBrowser(_loc: RoundLocation): Promise<void> {
	const url = buildStreetViewUrl(_loc);
	if (url) await open(url);
}
