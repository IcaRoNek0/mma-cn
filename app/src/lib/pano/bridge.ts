import type { Location, Pano } from "@/bindings.gen";
import { getLocal } from "@/lib/hooks/useLocalStorage";
import { DEFAULT_PREFS } from "@/store/mapEmbedPrefs";
import {
	getPanoramaProvider,
	isPanoSource,
	parsePanoDate,
	type PanoramaMetadata,
	type PanoSource,
} from "./index";

export function locationSource(location: Location): PanoSource {
	const source = location.extra?.source;
	if (isPanoSource(source)) return source;
	return getLocal("mapEmbedPrefs", DEFAULT_PREFS).panoProvider === "tencent"
		? "qq_pano"
		: "baidu_pano";
}

const dateString = (date: Date) =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Adapt provider metadata to the upstream editor's shared panorama model. */
export function metadataToPano(metadata: PanoramaMetadata): Pano {
	const date = parsePanoDate(metadata.panoId, metadata.source);
	const knownDate = date.getTime() !== 0 && Number.isFinite(date.getTime());
	const imageDate = knownDate ? dateString(date).slice(0, 7) : "";
	const level = metadata.tileLevels.at(-1)!;
	return {
		id: metadata.panoId,
		panoFrontend: 2,
		...metadata.position,
		altitude: metadata.altitude ?? 0,
		pov: null,
		worldSize: { width: level.width, height: level.rows * level.tileHeight },
		tileSize: { width: level.tileWidth, height: level.tileHeight },
		copyright: metadata.source === "baidu_pano" ? "Baidu" : "Tencent",
		description: metadata.address ?? "",
		shortDescription: metadata.address ?? "",
		uploaderName: null,
		countryCode: null,
		levelId: null,
		links: metadata.links.map((link) => ({ panoId: link.panoId, heading: link.heading ?? 0 })),
		time: metadata.timeline.map((entry) => ({
			panoId: entry.panoId,
			date: dateString(entry.date),
		})),
		date: knownDate
			? { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
			: null,
		source: metadata.source,
		imageDate,
		coverageDates: metadata.timeline.map((entry) => dateString(entry.date).slice(0, 7)),
		centerHeading: metadata.heading,
		cameraFrame: { heading: metadata.heading, pitch: metadata.pitch },
		cameraType: metadata.source === "qq_trekker" ? "trekker" : null,
	};
}

export async function chinaPano(location: Location, signal?: AbortSignal): Promise<Pano | null> {
	if (!location.panoId) return null;
	return metadataToPano(
		await getPanoramaProvider(locationSource(location)).getMetadata(location.panoId, signal),
	);
}
