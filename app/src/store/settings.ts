import { bridgeAcrossWindows, emit as emitEvent, useEventValue } from "@/lib/events";
import { getLocal, setLocal, reloadLocal } from "@/lib/hooks/useLocalStorage";
import { msg } from "@/lib/i18n";
import type { SavedSelection } from "./savedSelections";
import type { TagSortMode } from "@/types";
import type { PinnedEntry } from "./commandDefs";
import type { RGB } from "@/lib/util/color";

/** Language names stay in their own language, the way every language picker does it -- a reader
 *  looking for their own has to recognise it without already reading English.
 *  `en-XA` is the generated pseudolocale: accented and ~40% longer, so unextracted strings and
 *  layout overflow are visible without a translator. Offered in dev builds only. */
export const LANGUAGES = {
	en: "English",
	de: "Deutsch",
	es: "Español",
	fr: "Français",
	ja: "日本語",
	pl: "Polski",
	ru: "Русский",
	"zh-Hans": "简体中文",
	"en-XA": msg("Pseudolocale"),
} as const;

export const MOVEMENT_MODES = {
	moving: msg("Moving"),
	"no-move": msg("No Move"),
	nmpz: "NMPZ",
} as const;
export const SEEN_RESOLUTIONS = {
	low: msg("Low (160x90)"),
	medium: msg("Medium (320x180)"),
	high: msg("High (640x360)"),
} as const;
export const EXACT_DATE_FORMATS = {
	date: msg("Date only"),
	datetime: msg("Date + time"),
} as const;
export const DATE_TIMEZONES = {
	location: msg("Location timezone"),
	utc: "UTC",
} as const;
export const MAP_LIST_FIELDS = {
	locationCount: msg("Location count"),
	lastOpened: msg("Last opened"),
	created: msg("Date created"),
} as const;
export const DISCORD_PRESENCE_MODES = {
	off: msg("Off"),
	generic: msg("Generic (no map name)"),
	full: msg("Full (map name + count)"),
} as const;
export const GEOCODE_PROVIDERS = {
	local: msg("Local (offline)"),
	nominatim: "Nominatim",
	google: msg("Google (from panorama)"),
} as const;
export const GEOCODE_PROVIDER_LABELS: Record<keyof typeof GEOCODE_PROVIDERS, string> = {
	local: msg("Local reverse geocode"),
	nominatim: msg("OpenStreetMap (Nominatim)"),
	google: msg("Google Street View"),
};
export const TAG_VIEW_MODES = {
	flat: msg("Flat"),
	tree: msg("Tree"),
} as const;
export const TAG_FOLDER_COLOR_MODES = {
	direct: msg("Fixed color"),
	firstChild: msg("Inherit first child"),
} as const;
export const OPACITY_TOGGLE_MODES = {
	previous: msg("Last used opacity"),
	full: msg("Full opacity"),
} as const;
export const POLYGON_COLOR_MODES = {
	random: msg("Random"),
	fixed: msg("Fixed color"),
} as const;
export const BORDER_DETAILS = {
	light: msg("Standard (bundled)"),
	medium: msg("High (~10MB)"),
	heavy: msg("Ultra (~46MB)"),
} as const;
export const SUBDIVISION_DETAILS = {
	off: msg("Off"),
	adm1: msg("States / provinces"),
} as const;
/** Tag-suggestion list cap stops (slider indices); 0 = unlimited ("All"). */
export const TAG_SUGGESTION_LIMITS = [5, 10, 25, 50, 0] as const;
export const PREVIEW_ASPECT_RATIOS = {
	"4 / 3": "4:3",
	"16 / 10": "16:10",
	"16 / 9": "16:9",
	"21 / 9": "21:9",
	"32 / 9": "32:9",
	free: msg("Free"),
} as const;
export const INPUT_SENSITIVITY_MIN = 0.25;
export const INPUT_SENSITIVITY_MAX = 3;
export const INPUT_SENSITIVITY_STEP = 0.25;

export function normalizeInputSensitivity(value: unknown): number {
	const number = typeof value === "number" ? value : Number.NaN;
	if (!Number.isFinite(number)) return 1;
	return Math.min(INPUT_SENSITIVITY_MAX, Math.max(INPUT_SENSITIVITY_MIN, number));
}

export type Language = keyof typeof LANGUAGES;
export type MovementMode = keyof typeof MOVEMENT_MODES;
export const MOVEMENT_CYCLE = Object.keys(MOVEMENT_MODES) as MovementMode[];
export type ExactDateFormat = keyof typeof EXACT_DATE_FORMATS;
export type DateTimezone = keyof typeof DATE_TIMEZONES;
export type SeenResolution = keyof typeof SEEN_RESOLUTIONS;

export type MapListField = keyof typeof MAP_LIST_FIELDS;
export type DiscordPresenceMode = keyof typeof DISCORD_PRESENCE_MODES;
export type GeocodeProvider = keyof typeof GEOCODE_PROVIDERS;
export type TagViewMode = keyof typeof TAG_VIEW_MODES;
export type TagFolderColorMode = keyof typeof TAG_FOLDER_COLOR_MODES;
export type OpacityToggleMode = keyof typeof OPACITY_TOGGLE_MODES;
export type PolygonColorMode = keyof typeof POLYGON_COLOR_MODES;
export type BorderDetail = keyof typeof BORDER_DETAILS;
export type SubdivisionDetail = keyof typeof SUBDIVISION_DETAILS;
export type PreviewAspectRatio = keyof typeof PREVIEW_ASPECT_RATIOS;

const DEFAULTS = {
	showCameraBadges: true,
	showLinksControl: true,
	clickToGo: true,
	showRoadLabels: false,
	defaultMovementMode: "moving" as MovementMode,
	showCar: true,
	showCrosshair: false,
	showCompass: true,
	showCompassTape: false,
	showZoom: true,
	showReturnToSpawn: true,
	showJumpButtons: true,
	showMapLinks: true,
	showCoordinateDisplay: true,
	showFullscreenButton: true,
	showScreenshotButton: true,
	showPanoMetadata: false,
	exactDateFormat: "date" as ExactDateFormat,
	dateTimezone: "location" as DateTimezone,
	showNavArrow: true,
	showGroundArrow: true,
	hidePanoUI: false,
	/** Hiding the pano UI also hides navigation: link arrows, ground arrow, click-to-go X. */
	hideNavWithUI: true,
	fullscreenMap: false,
	showFullscreenMapMeta: false,
	showFullscreenMiniLocationPreview: true,
	fullscreenMiniLocationScale: 1,
	showFullscreenMinimap: true,
	fullscreenMinimapScale: 1,
	/** Milliseconds the fullscreen minimap stays expanded after the pointer leaves it. */
	fullscreenMinimapCloseDelay: 250,
	showFullscreenTagbar: true,
	/** Tag bar dropped down to a thin strip. Toggled from the bar itself, not Settings. */
	fullscreenTagbarCollapsed: false,
	showFullscreenDatePicker: true,
	showFullscreenReviewBar: true,
	showFullscreenGeocode: true,
	customCss: "",
	enableSeen: true,
	enableSeenThumbnails: true,
	seenResolution: "medium" as SeenResolution,
	mapPanSpeed: 6,
	mapZoomSensitivity: 1,
	panoLookSpeed: 3,
	panoRotateSensitivity: 1,
	slowModifier: 4,
	showFps: false,
	mapListFields: ["locationCount"] as MapListField[],
	/** Read once at boot; changing it relaunches the app rather than re-rendering. */
	language: "en" as Language,
	/** Reopen the maps that were open when the session last ended (main window closed). */
	restoreSession: true,
	/** Discord Rich Presence: off, generic (no map name), or full (map name + count). */
	discordPresence: "off" as DiscordPresenceMode,
	/** Per-label color overrides (hex), keyed by lowercased label name. Shared across all maps. */
	labelColors: {} as Record<string, string>,
	geocodeProvider: "local" as GeocodeProvider,
	nominatimApiKey: "",
	panToImported: true,
	/** Min half-extent (degrees) a single pasted/imported point is padded to before fitBounds */
	pastePadding: 0.003 as number,
	followActiveInReview: true,
	markerColor: { r: 42, g: 42, b: 42 } as RGB,
	activeLocationColor: { r: 200, g: 0, b: 0 } as RGB,
	importPreviewColor: { r: 217, g: 70, b: 239 } as RGB,
	panoDotColor: { r: 255, g: 0, b: 0 } as RGB,
	/** Color a newly drawn polygon selection starts with. `random` hashes it from the polygon's
	 *  key; `fixed` uses polygonColor. Either way it's only the initial value -- recoloring a
	 *  polygon by hand still wins. */
	/** What the layer opacity hotkeys restore a layer to when toggling it back on. */
	opacityToggleMode: "previous" as OpacityToggleMode,
	polygonColorMode: "random" as PolygonColorMode,
	polygonColor: { r: 0, g: 140, b: 255 } as RGB,
	panoDotScaled: false,
	tagViewMode: "flat" as TagViewMode,
	/** Tree view only: render each tag as the shortest path suffix that's still unique. */
	truncateTagPaths: true,
	/** Tree view: how a colorless folder row gets its color. `direct` uses tagFolderColor;
	 *  `firstChild` inherits the first own-colored descendant in display order,
	 *  with tagFolderColor as the fallback for colorless subtrees. */
	tagFolderColorMode: "direct" as TagFolderColorMode,
	tagFolderColor: { r: 136, g: 136, b: 136 } as RGB,
	tagSortMode: "default" as TagSortMode,
	/** Gap between tag pills (px), shared by flat and tree views via `--tag-gap`. */
	tagGap: 6 as number,
	animateTagReorder: true,
	borderDetail: "light" as BorderDetail,
	subdivisionDetail: "off" as SubdivisionDetail,
	previewAspectRatio: "16 / 9" as PreviewAspectRatio,
	tagSuggestionLimit: 0 as number,
	savedSelections: [] as SavedSelection[],
	/** Local REST transport for window.MMA (Settings > Advanced). */
	remoteApi: false,
	remoteApiKey: "",
	pinnedCommands: [
		"deselectAll",
		"selection-delete-locations",
		"review-selected",
		"review-sessions",
		"---",
		"select-unpanned",
		"select-untagged",
		"---",
		"find-duplicates",
		"filter-by-metadata",
		"---",
		"bulk-enrich",
	] as PinnedEntry[],
	hasSeenWelcome: false,
};
export type AppSettings = typeof DEFAULTS;

/** App settings mirrored to CSS custom properties on `:root`. Add an entry to expose a
 *  setting to CSS; `useCssVarSettings` (App.tsx) keeps them in sync reactively. */
export const CSS_VAR_SETTINGS: ReadonlyArray<
	readonly [cssVar: string, value: (s: AppSettings) => string]
> = [["--tag-gap", (s) => `${s.tagGap}px`]];

const STORAGE_KEY = "appSettings";

let settings: AppSettings = { ...getLocal(STORAGE_KEY, DEFAULTS) };

// Another window changed settings: reread the shared localStorage before re-emitting.
bridgeAcrossWindows("settings:changed", () => {
	settings = { ...reloadLocal(STORAGE_KEY, DEFAULTS) };
});

export function getSettings(): AppSettings {
	return settings;
}

/** True while the pano-UI toggle covers the navigation visuals too. */
export function navHiddenWithUI(s: AppSettings): boolean {
	return s.hidePanoUI && s.hideNavWithUI;
}

/** Effective StreetViewPanorama options: how the movement mode, per-control toggles,
 *  and the hide-UI toggle compose. Sole authority for both pano creation and updates. */
export function panoDisplayOptions(s: AppSettings) {
	const noMove = s.defaultMovementMode !== "moving";
	return {
		linksControl: !noMove && !navHiddenWithUI(s) && s.showLinksControl,
		clickToGo: !noMove && s.clickToGo,
		showRoadLabels: s.showRoadLabels,
		scrollwheel: s.defaultMovementMode !== "nmpz",
	};
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
	settings = { ...settings, [key]: value };
	setLocal(STORAGE_KEY, settings);
	emitEvent("settings:changed");
}

export function useSettings(): AppSettings {
	return useEventValue("settings:changed", getSettings);
}

export function useSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
	return useEventValue("settings:changed", () => getSettings()[key]);
}
