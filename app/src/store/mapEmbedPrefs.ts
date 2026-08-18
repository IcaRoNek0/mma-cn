import type {
	SvColor,
	MapTypeKey,
	SvCoverageType,
	SvThickness,
	MarkerStyle,
	PanoProviderKey,
} from "@/types";
import type { OpacityToggleMode } from "./settings";

export interface MapEmbedPrefs {
	panoProvider: PanoProviderKey;
	svOpacity: number;
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
	markerSize: number;
	showPerfectScoreCircle: boolean;
	showSearchRadiusCursor: boolean;
	showPreviews: boolean;
	selectOnly: boolean;
	findNearbyPanoOnClick: boolean;
}

export const DEFAULT_PREFS: MapEmbedPrefs = {
	panoProvider: "baidu",
	svOpacity: 0.5,
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
	markerSize: 1,
	showPerfectScoreCircle: true,
	showSearchRadiusCursor: false,
	showPreviews: false,
	selectOnly: false,
	findNearbyPanoOnClick: true,
};

export const MARKER_OPACITY_STEPS = [1, 0.35, 0] as const;

/** Cycle the map's unselected marker layer through the three toolbar states. */
export function cycleMarkerOpacity(current: number): number {
	const index = MARKER_OPACITY_STEPS.findIndex((value) => value === current);
	return MARKER_OPACITY_STEPS[index < 0 ? 0 : (index + 1) % MARKER_OPACITY_STEPS.length];
}

/** Next value for a layer opacity toggle: a visible layer goes off, a hidden one comes
 *  back at `lastNonZero` (or full, per the setting). */
export function toggledOpacity(
	current: number,
	lastNonZero: number,
	mode: OpacityToggleMode,
): number {
	if (current > 0) return 0;
	return mode === "full" || lastNonZero <= 0 ? 1 : lastNonZero;
}
