import type { SvColor, MapTypeKey, SvCoverageType, SvThickness, MarkerStyle } from "@/types";
import type { OpacityToggleMode } from "./settings";
import { persisted } from "@/lib/hooks/useLocalStorage";
import { msg } from "@/lib/i18n";

/** Basemap order: also the order the previous/next basemap commands step through. */
export const MAP_TYPES: readonly MapTypeKey[] = ["map"];

export const MAP_TYPE_LABELS: Record<MapTypeKey, string> = {
	map: msg("Huawei Map"),
	satellite: msg("Satellite"),
	osm: msg("OSM"),
	vector: msg("Vector"),
};

export interface MapEmbedPrefs {
	panoProvider: "baidu" | "tencent";
	findNearbyPanoOnClick: boolean;
	svOpacity: number;
	svVisible: boolean;
	svColor: SvColor;
	showLabels: boolean;
	showTerrain: boolean;
	svPanoramas: boolean;
	svCoverageType: SvCoverageType;
	svThickness: SvThickness;
	svBlobby: boolean;
	boldCountryBorders: boolean;
	boldSubdivisionBorders: boolean;
	hideRoadLabels: boolean;
	hidePoi: boolean;
	hideTransit: boolean;
	hideHighways: boolean;
	mapStyleName: string;
	vectorStyleName: string;
	mapType: MapTypeKey;
	markerStyle: MarkerStyle;
	markerOpacity: number;
	markerVisible: boolean;
	selectedOpacity: number;
	selectedVisible: boolean;
	markerSize: number;
	showPerfectScoreCircle: boolean;
	showSearchRadiusCursor: boolean;
	showPreviews: boolean;
	clickMode: ClickMode;
}

/** What clicking empty map does: create a location, nothing, or snap to the nearest one. */
export type ClickMode = "default" | "selectOnly" | "nearest";

export const DEFAULT_PREFS: MapEmbedPrefs = {
	panoProvider: "baidu",
	findNearbyPanoOnClick: true,
	svOpacity: 0.5,
	svVisible: true,
	svColor: "#1098ad",
	showLabels: true,
	showTerrain: false,
	svPanoramas: false,
	svCoverageType: "official",
	svThickness: "default",
	svBlobby: false,
	boldCountryBorders: false,
	boldSubdivisionBorders: false,
	hideRoadLabels: false,
	hidePoi: false,
	hideTransit: false,
	hideHighways: false,
	mapStyleName: "default",
	vectorStyleName: "liberty",
	mapType: "map",
	markerStyle: "pin",
	markerOpacity: 1,
	markerVisible: true,
	selectedOpacity: 1,
	selectedVisible: true,
	markerSize: 1,
	showPerfectScoreCircle: true,
	showSearchRadiusCursor: false,
	showPreviews: false,
	clickMode: "default",
};

export const MAP_EMBED_PREFS = persisted("mapEmbedPrefs", DEFAULT_PREFS);

/** A map layer with its own opacity and visibility: Street View coverage, unselected markers,
 *  or selected markers. */
export type OpacityLayer = "sv" | "marker" | "selected";

/** What a layer renders at: its opacity, gated by its visibility. */
export function layerOpacity(prefs: MapEmbedPrefs, layer: OpacityLayer): number {
	return prefs[`${layer}Visible`] ? prefs[`${layer}Opacity`] : 0;
}

/** Next state for a layer visibility toggle. Hiding keeps the opacity value, so showing
 *  restores it -- or full opacity, per the setting. */
export function toggledLayer(
	opacity: number,
	visible: boolean,
	mode: OpacityToggleMode,
): { opacity: number; visible: boolean } {
	if (visible) return { opacity, visible: false };
	return { opacity: mode === "full" || opacity <= 0 ? 1 : opacity, visible: true };
}

export const MARKER_OPACITY_STEPS = [1, 0.35, 0] as const;
export function cycleMarkerOpacity(current: number): number {
	const index = MARKER_OPACITY_STEPS.findIndex((value) => value === current);
	return MARKER_OPACITY_STEPS[index < 0 ? 0 : (index + 1) % MARKER_OPACITY_STEPS.length];
}
