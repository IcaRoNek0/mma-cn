import { createPluginStorage } from "@/plugins/registry";
import type { StreakMode } from "./GameState";

const PLUGIN_ID = "localguessr";
const STREAK_KEY = "globalStreak";

const storage = createPluginStorage(PLUGIN_ID);

export interface GlobalStreak {
	country: number;
	state: number;
}

const DEFAULT: GlobalStreak = { country: 0, state: 0 };

function normalize(raw: unknown): GlobalStreak {
	if (!raw || typeof raw !== "object") return { ...DEFAULT };
	const o = raw as Partial<GlobalStreak>;
	return {
		country: Math.max(0, Math.floor(Number(o.country) || 0)),
		state: Math.max(0, Math.floor(Number(o.state) || 0)),
	};
}

/** Plugin-wide country/state streaks — survive across games (not per-session). */
export function getGlobalStreak(): GlobalStreak {
	return normalize(storage.get(STREAK_KEY, DEFAULT));
}

export function setGlobalStreak(patch: Partial<GlobalStreak>): GlobalStreak {
	const next = { ...getGlobalStreak(), ...patch };
	const normalized = normalize(next);
	storage.set(STREAK_KEY, normalized);
	return normalized;
}

/** Apply a round hit/miss to the matching global streak counter. */
export function applyGlobalStreakHit(mode: StreakMode, hit: boolean | null): GlobalStreak {
	const current = getGlobalStreak();
	if (mode === "country" && hit != null) {
		return setGlobalStreak({ country: hit ? current.country + 1 : 0 });
	}
	if (mode === "state" && hit != null) {
		return setGlobalStreak({ state: hit ? current.state + 1 : 0 });
	}
	return current;
}
