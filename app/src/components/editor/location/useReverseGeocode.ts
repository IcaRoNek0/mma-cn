import { cmd } from "@/lib/commands";
import { getSettings } from "@/store/settings";
import { log } from "@/lib/util/log";
import { useAsync } from "@/lib/hooks/useAsync";

export interface GeoDisplay {
	address: string;
	countryCode: string | null;
}

async function geocodeLocal(lat: number, lng: number, source?: string | null): Promise<GeoDisplay | null> {
	const result = await cmd.reverseGeocode(lat, lng, source ?? null);
	if (!result) return null;
	const parts = [result.city, result.admin].filter(Boolean);
	return {
		address:
			result.formatted_address ||
			[result.province, result.city, result.district, result.town].filter(Boolean).join(", ") ||
			parts.join(", "),
		countryCode: result.country_code?.toUpperCase() ?? null,
	};
}

async function geocodeNominatim(lat: number, lng: number): Promise<GeoDisplay | null> {
	const apiKey = getSettings().nominatimApiKey;
	const url = new URL("https://nominatim.openstreetmap.org/reverse");
	url.searchParams.set("lat", String(lat));
	url.searchParams.set("lon", String(lng));
	url.searchParams.set("format", "json");
	url.searchParams.set("zoom", "14");
	if (apiKey) url.searchParams.set("key", apiKey);
	const res = await fetch(url.toString(), { headers: { "Accept-Language": "en" } });
	if (!res.ok) return null;
	const data = await res.json();
	if (!data?.address) return null;
	const a = data.address;
	const parts = [a.road, a.suburb || a.town || a.city || a.village, a.state || a.county].filter(
		Boolean,
	);
	return {
		address: parts.join(", "),
		countryCode: (a.country_code as string)?.toUpperCase() ?? null,
	};
}

export function useReverseGeocode(
	lat: number,
	lng: number,
	panoGeo?: GeoDisplay | null,
	source?: string | null,
): GeoDisplay | null {
	const provider = getSettings().geocodeProvider;

	const asyncResult = useAsync(async () => {
		if (provider === "google") return null;
		const fn =
			provider === "nominatim"
				? () => geocodeNominatim(lat, lng)
				: () => geocodeLocal(lat, lng, source);
		try {
			return await fn();
		} catch (e) {
			log.warn("[geocode] reverse geocode failed:", e);
			return null;
		}
	}, [lat, lng, provider, source]).data;

	if (provider === "google") return panoGeo ?? null;
	return asyncResult;
}
