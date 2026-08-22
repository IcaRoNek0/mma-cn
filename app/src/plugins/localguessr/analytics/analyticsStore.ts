import { getSessions } from "../gameSessionStore";
import type { GameSession, MovementMode } from "../GameState";
import { resolveCountryName } from "../GameState";
import { computeBestStreak } from "../streakValidator";

export interface AnalyticsOverview {
	gamesPlayed: number;
	totalRounds: number;
	averageScore: number;
	bestScore: number;
	bestStreak: number;
	perfectRounds: number;
}

export interface CountryStat {
	countryCode: string;
	countryName: string;
	rounds: number;
	hits: number;
	accuracy: number;
	avgScore: number;
}

export interface MapStat {
	mapId: string;
	mapName: string;
	games: number;
	avgScore: number;
	bestScore: number;
}

export interface ModeStat {
	mode: MovementMode;
	games: number;
	avgScore: number;
}

export interface ProviderStat {
	provider: string;
	rounds: number;
	avgScore: number;
}

export interface AnalyticsData {
	overview: AnalyticsOverview;
	byCountry: CountryStat[];
	byMap: MapStat[];
	byMode: ModeStat[];
	byProvider: ProviderStat[];
	recent: GameSession[];
	scoreTrend: {
		at: number;
		avgScore: number;
		totalScore: number;
		roundCount: number;
		mapName: string;
		mapId: string;
		countryCodes: string[];
		providers: string[];
		mode: string;
	}[];
}

function countryHit(r: {
	streakHit: boolean | null;
	guessCountryCode: string | null;
	countryCode: string | null;
}): boolean {
	if (r.streakHit === true) return true;
	return !!r.guessCountryCode && !!r.countryCode && r.guessCountryCode === r.countryCode;
}

export function computeAnalytics(filterMapId?: string | null): AnalyticsData {
	let sessions = getSessions();
	if (filterMapId) sessions = sessions.filter((s) => s.mapId === filterMapId);

	const overview: AnalyticsOverview = {
		gamesPlayed: sessions.length,
		totalRounds: 0,
		averageScore: 0,
		bestScore: 0,
		bestStreak: 0,
		perfectRounds: 0,
	};

	let scoreSum = 0;
	const countryMap = new Map<
		string,
		{ name: string; rounds: number; hits: number; scoreSum: number }
	>();
	const mapMap = new Map<string, { name: string; games: number; scoreSum: number; best: number }>();
	const modeMap = new Map<MovementMode, { games: number; scoreSum: number }>();
	const providerMap = new Map<string, { rounds: number; scoreSum: number }>();

	for (const s of sessions) {
		overview.totalRounds += s.rounds.length;
		scoreSum += s.totalScore;
		overview.bestScore = Math.max(overview.bestScore, s.totalScore);
		overview.bestStreak = Math.max(
			overview.bestStreak,
			s.streak,
			s.stateStreak ?? 0,
			computeBestStreak(s.rounds),
		);

		const mm = mapMap.get(s.mapId) ?? {
			name: s.mapName,
			games: 0,
			scoreSum: 0,
			best: 0,
		};
		mm.games++;
		mm.scoreSum += s.totalScore;
		mm.best = Math.max(mm.best, s.totalScore);
		mapMap.set(s.mapId, mm);

		const mode = s.config.movementMode;
		const md = modeMap.get(mode) ?? { games: 0, scoreSum: 0 };
		md.games++;
		md.scoreSum += s.totalScore;
		modeMap.set(mode, md);

		for (const r of s.rounds) {
			if (r.score >= 5000) overview.perfectRounds++;
			const code = r.countryCode ?? "??";
			const resolvedName = resolveCountryName(code, r.countryName) || "Unknown";
			const c = countryMap.get(code) ?? {
				name: resolvedName,
				rounds: 0,
				hits: 0,
				scoreSum: 0,
			};
			c.rounds++;
			c.scoreSum += r.score;
			if (countryHit(r)) c.hits++;
			countryMap.set(code, c);

			// Provider stats
			const prov = r.location.provider || "unknown";
			const pv = providerMap.get(prov) ?? { rounds: 0, scoreSum: 0 };
			pv.rounds++;
			pv.scoreSum += r.score;
			providerMap.set(prov, pv);
		}
	}

	overview.averageScore = sessions.length > 0 ? Math.round(scoreSum / sessions.length) : 0;

	const byCountry: CountryStat[] = [...countryMap.entries()]
		.map(([countryCode, v]) => ({
			countryCode,
			countryName: v.name,
			rounds: v.rounds,
			hits: v.hits,
			accuracy: v.rounds > 0 ? Math.round((v.hits / v.rounds) * 100) : 0,
			avgScore: v.rounds > 0 ? Math.round(v.scoreSum / v.rounds) : 0,
		}))
		.sort((a, b) => b.rounds - a.rounds);

	const byMap: MapStat[] = [...mapMap.entries()]
		.map(([mapId, v]) => ({
			mapId,
			mapName: v.name,
			games: v.games,
			avgScore: Math.round(v.scoreSum / v.games),
			bestScore: v.best,
		}))
		.sort((a, b) => b.games - a.games);

	const byMode: ModeStat[] = [...modeMap.entries()].map(([mode, v]) => ({
		mode,
		games: v.games,
		avgScore: Math.round(v.scoreSum / v.games),
	}));

	const byProvider: ProviderStat[] = [...providerMap.entries()]
		.map(([provider, v]) => ({
			provider,
			rounds: v.rounds,
			avgScore: Math.round(v.scoreSum / v.rounds),
		}))
		.sort((a, b) => b.rounds - a.rounds);

	const recentSessions = [...sessions].reverse().slice(-30);
	const scoreTrend = recentSessions.map((s) => {
		const countryCodes = [
			...new Set(s.rounds.map((r) => r.countryCode).filter(Boolean) as string[]),
		];
		const providers = [
			...new Set(s.rounds.map((r) => r.location.provider).filter(Boolean) as string[]),
		];
		return {
			at: s.finishedAt ?? s.startedAt,
			avgScore: s.rounds.length > 0 ? Math.round(s.totalScore / s.rounds.length) : 0,
			totalScore: s.totalScore,
			roundCount: s.rounds.length,
			mapName: s.mapName,
			mapId: s.mapId,
			countryCodes,
			providers,
			mode: s.config.movementMode,
		};
	});

	return {
		overview,
		byCountry,
		byMap,
		byMode,
		byProvider,
		recent: sessions.slice(0, 20),
		scoreTrend,
	};
}
