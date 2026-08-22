import { useReducer, useCallback } from "react";
import type { Location } from "@/bindings.gen";
import type { LatLng } from "@/types";
import { applyGlobalStreakHit, getGlobalStreak } from "./streakStore";

/** Map app locale to the i18n-iso-countries locale key. */
function isoLocale(appLocale: string | undefined): string {
	if (!appLocale || appLocale === "en") return "en";
	if (appLocale === "zh-Hans" || appLocale === "zh-CN") return "zh";
	return "en";
}

export type GamePhase = "config" | "playing" | "result" | "summary" | "analytics" | "replay";
export type MovementMode = "no-move" | "nmpz";
export type RoundMode = "classic" | "infinite";
export type TimerMode = "countdown" | "countup" | "off";
export type StreakMode = "off" | "country" | "state";
export type GeocodeBackend = "local" | "nominatim";

/** Render country flag using app's built-in SVG flags.
 *  Returns an <img> tag pointing to /flags/XX.svg (e.g. /flags/CN.svg). */
export function countryFlagHtml(code: string | null): string {
	if (!code || code.length !== 2) return "";
	const upper = code.toUpperCase();
	return `<img height="15" width="20" alt="${upper}" src="/flags/${upper}.svg" style="border-radius: 2px; vertical-align: middle;">`;
}

/** Alias kept for compatibility — same as countryFlagHtml. */
export function countryCodeToFlag(code: string | null): string {
	return countryFlagHtml(code);
}

// Resolve country name using i18n-iso-countries (primary) with Intl.DisplayNames fallback.
export function resolveCountryName(
	countryCode: string | null,
	countryName: string | null,
	locale?: string,
): string | null {
	if (!countryCode && !countryName) return null;
	const trimmed = countryName?.trim();
	if (trimmed && trimmed.length !== 2) return trimmed;
	const code = (countryCode ?? trimmed ?? "").toUpperCase();
	if (code.length !== 2) return trimmed || null;
	const l = isoLocale(locale);
	try {
		return new Intl.DisplayNames(l, { type: "region" }).of(code) ?? code;
	} catch {
		return code;
	}
}

export function formatCountryLabel(
	countryCode: string | null,
	countryName: string | null,
	admin?: string | null,
	locale?: string,
): string {
	const flagHtml = countryFlagHtml(countryCode);
	const name = resolveCountryName(countryCode, countryName, locale);
	const countryPart = name
		? `${flagHtml ? `${flagHtml}&#8239;` : ""}${name}`.trim()
		: flagHtml || "";
	if (!countryPart && admin) return admin;
	if (admin) return `${countryPart}, ${admin}`;
	return countryPart;
}

/** Migrate legacy streak setting. */
export function normalizeStreakMode(mode: string | undefined): StreakMode {
	if (mode === "country" || mode === "state" || mode === "off") return mode;
	if (mode === "on") return "country";
	return "off";
}

export interface GameConfig {
	movementMode: MovementMode;
	roundMode: RoundMode;
	/** Number of rounds for classic mode (default 5). Ignored for infinite. */
	classicRounds: number;
	timerMode: TimerMode;
	/** Seconds for countdown timer. */
	timeLimit: number;
	streakMode: StreakMode;
	geocodeBackend: GeocodeBackend;
	nominatimApiKey: string;
	/** Optional score max-distance override; null uses the map's score bounds. */
	maxDistance: number | null;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
	movementMode: "no-move",
	roundMode: "classic",
	classicRounds: 5,
	timerMode: "off",
	timeLimit: 60,
	streakMode: "off",
	geocodeBackend: "local",
	nominatimApiKey: "",
	maxDistance: null,
};

export interface RoundLocation {
	id: number;
	lat: number;
	lng: number;
	heading: number;
	pitch: number;
	zoom: number;
	panoId: string | null;
	provider: string | null;
}

export interface RoundResult {
	location: RoundLocation;
	guess: LatLng | null;
	distanceMeters: number | null;
	score: number;
	/** True location country ISO code (from reverse geocode). */
	countryCode: string | null;
	countryName: string | null;
	/** First-level admin (state/province). */
	admin: string | null;
	/** Guess country ISO code (for streak validation). */
	guessCountryCode: string | null;
	guessCountryName: string | null;
	guessAdmin: string | null;
	/** Whether the streak continued after this round. */
	streakHit: boolean | null;
	/** Whether the state streak continued after this round. */
	stateStreakHit: boolean | null;
	elapsedMs: number;
}

/** Consecutive streak hits in rounds before the last entry (for “streak ended” copy). */
export function streakRunBeforeLastRound(rounds: RoundResult[], mode: "country" | "state"): number {
	if (rounds.length < 2) return 0;
	const prior = rounds.slice(0, -1);
	let n = 0;
	for (let i = prior.length - 1; i >= 0; i--) {
		const hit = mode === "country" ? prior[i].streakHit : prior[i].stateStreakHit;
		if (hit) n++;
		else break;
	}
	return n;
}

export interface GameSession {
	id: string;
	mapId: string;
	mapName: string;
	config: GameConfig;
	/** Max error distance (km-scale units from scoreBounds) used for scoring. */
	maxErrorDistance: number;
	startedAt: number;
	finishedAt: number | null;
	rounds: RoundResult[];
	totalScore: number;
	/** Final country streak length when streak mode is on. */
	streak: number;
	/** Final state streak length when streak mode is on. */
	stateStreak: number;
}

export interface ActiveGame {
	sessionId: string;
	mapId: string;
	mapName: string;
	config: GameConfig;
	maxErrorDistance: number;
	locations: RoundLocation[];
	currentRoundIndex: number;
	rounds: RoundResult[];
	/** Current country streak count (consecutive correct country). */
	streak: number;
	/** Current state streak count (consecutive correct state/admin). */
	stateStreak: number;
	/** When the current round timer started. */
	roundStartedAt: number;
	/** When this game session was first started (for ongoing list). */
	gameStartedAt: number;
	guess: LatLng | null;
	phase: Extract<GamePhase, "playing" | "result">;
}

export interface GameUiState {
	phase: GamePhase;
	config: GameConfig;
	active: ActiveGame | null;
	lastSession: GameSession | null;
}

export type GameAction =
	| { type: "SET_CONFIG"; patch: Partial<GameConfig> }
	| { type: "START"; active: ActiveGame }
	| { type: "RESUME"; active: ActiveGame }
	| { type: "SET_GUESS"; guess: LatLng }
	| { type: "SHOW_RESULT"; result: RoundResult }
	| { type: "NEXT_ROUND"; nextIndex: number; nextLocationReadyAt: number }
	| { type: "EXTEND_LOCATIONS"; locations: RoundLocation[] }
	| { type: "FINISH"; session: GameSession }
	| { type: "SHOW_ANALYTICS" }
	| { type: "SHOW_REPLAY"; session: GameSession }
	| { type: "BACK_TO_CONFIG" }
	| { type: "ABORT" };

export function locationToRoundLoc(loc: Location): RoundLocation {
	return {
		id: loc.id,
		lat: loc.lat,
		lng: loc.lng,
		heading: loc.heading,
		pitch: loc.pitch,
		zoom: loc.zoom,
		panoId: loc.panoId,
		provider:
			loc.extra?.source === "baidu_pano"
				? "baidu"
				: loc.extra?.source === "qq_pano" || loc.extra?.source === "qq_trekker"
					? "tencent"
					: null,
	};
}

/** Fisher–Yates shuffle, then take up to `n` items. */
export function pickRandomLocations(all: Location[], n: number): RoundLocation[] {
	const copy = [...all];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy.slice(0, Math.min(n, copy.length)).map(locationToRoundLoc);
}

function newSessionId(): string {
	return `gg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createActiveGame(opts: {
	mapId: string;
	mapName: string;
	config: GameConfig;
	maxErrorDistance: number;
	locations: RoundLocation[];
}): ActiveGame {
	const global = getGlobalStreak();
	return {
		sessionId: newSessionId(),
		mapId: opts.mapId,
		mapName: opts.mapName,
		config: opts.config,
		maxErrorDistance: opts.maxErrorDistance,
		locations: opts.locations,
		currentRoundIndex: 0,
		rounds: [],
		streak: global.country,
		stateStreak: global.state,
		roundStartedAt: Date.now(),
		gameStartedAt: Date.now(),
		guess: null,
		phase: "playing",
	};
}

export function toFinishedSession(active: ActiveGame, finalRounds: RoundResult[]): GameSession {
	const totalScore = finalRounds.reduce((s, r) => s + r.score, 0);
	return {
		id: active.sessionId,
		mapId: active.mapId,
		mapName: active.mapName,
		config: active.config,
		maxErrorDistance: active.maxErrorDistance,
		startedAt: active.gameStartedAt,
		finishedAt: Date.now(),
		rounds: finalRounds,
		totalScore,
		// Persist the running (plugin-global) streak values at finish time.
		streak: active.config.streakMode === "country" ? active.streak : 0,
		stateStreak: active.config.streakMode === "state" ? active.stateStreak : 0,
	};
}

const INITIAL: GameUiState = {
	phase: "config",
	config: DEFAULT_GAME_CONFIG,
	active: null,
	lastSession: null,
};

function reducer(state: GameUiState, action: GameAction): GameUiState {
	switch (action.type) {
		case "SET_CONFIG":
			return { ...state, config: { ...state.config, ...action.patch } };
		case "START":
			return {
				...state,
				phase: "playing",
				active: action.active,
				lastSession: null,
			};
		case "RESUME": {
			const global = getGlobalStreak();
			return {
				...state,
				phase: action.active.phase,
				active: {
					...action.active,
					streak: global.country,
					stateStreak: global.state,
				},
				lastSession: null,
			};
		}
		case "SET_GUESS":
			if (!state.active) return state;
			return { ...state, active: { ...state.active, guess: action.guess } };
		case "SHOW_RESULT": {
			if (!state.active) return state;
			const rounds = [...state.active.rounds, action.result];
			const mode = state.active.config.streakMode;
			const hit =
				mode === "country"
					? action.result.streakHit
					: mode === "state"
						? action.result.stateStreakHit
						: null;
			const global = applyGlobalStreakHit(mode, hit);
			return {
				...state,
				phase: "result",
				active: {
					...state.active,
					rounds,
					streak: global.country,
					stateStreak: global.state,
					phase: "result",
					guess: action.result.guess,
				},
			};
		}
		case "NEXT_ROUND":
			if (!state.active) return state;
			return {
				...state,
				phase: "playing",
				active: {
					...state.active,
					currentRoundIndex: action.nextIndex,
					roundStartedAt: action.nextLocationReadyAt,
					guess: null,
					phase: "playing",
				},
			};
		case "EXTEND_LOCATIONS":
			if (!state.active) return state;
			return {
				...state,
				active: {
					...state.active,
					locations: [...state.active.locations, ...action.locations],
				},
			};
		case "FINISH":
			return {
				...state,
				phase: "summary",
				active: null,
				lastSession: action.session,
			};
		case "SHOW_ANALYTICS":
			return { ...state, phase: "analytics", active: null };
		case "SHOW_REPLAY":
			return { ...state, phase: "replay", active: null, lastSession: action.session };
		case "BACK_TO_CONFIG":
		case "ABORT":
			return {
				...state,
				phase: "config",
				active: null,
			};
		default:
			return state;
	}
}

export function useGameReducer(initialConfig?: Partial<GameConfig>) {
	const [state, dispatch] = useReducer(reducer, undefined, () => ({
		...INITIAL,
		config: { ...DEFAULT_GAME_CONFIG, ...initialConfig },
	}));

	const setConfig = useCallback((patch: Partial<GameConfig>) => {
		dispatch({ type: "SET_CONFIG", patch });
	}, []);

	return { state, dispatch, setConfig };
}

export function currentRoundLocation(active: ActiveGame): RoundLocation | null {
	return active.locations[active.currentRoundIndex] ?? null;
}

export function isLastRound(active: ActiveGame): boolean {
	if (active.config.roundMode === "infinite") return false;
	return active.currentRoundIndex >= active.locations.length - 1;
}

export function totalRoundsLabel(active: ActiveGame): string {
	if (active.config.roundMode === "infinite") return "∞";
	return String(active.locations.length);
}
