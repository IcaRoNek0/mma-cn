import {
	resolveCountryName,
	streakRunBeforeLastRound,
	type RoundResult,
	type StreakMode,
} from "./GameState";
import type { useT } from "@/lib/i18n";

type TFn = ReturnType<typeof useT>["t"];

function truthCountryLabel(r: RoundResult, locale: string): string {
	return resolveCountryName(r.countryCode, r.countryName, locale) ?? r.countryCode ?? "Unknown";
}

function guessCountryLabel(r: RoundResult, locale: string): string {
	return (
		resolveCountryName(r.guessCountryCode, r.guessCountryName, locale) ??
		r.guessCountryCode ??
		"Unknown"
	);
}

function truthStateLabel(r: RoundResult, locale: string): string {
	return r.admin?.trim() || truthCountryLabel(r, locale);
}

function guessStateLabel(r: RoundResult, locale: string): string {
	return r.guessAdmin?.trim() || guessCountryLabel(r, locale);
}

export function streakResultMessage(
	result: RoundResult,
	rounds: RoundResult[],
	streakMode: StreakMode,
	streak: number,
	stateStreak: number,
	t: TFn,
	locale: string,
): string | null {
	if (streakMode === "off") return null;

	if (streakMode === "country") {
		if (result.streakHit === null) return null;
		if (result.streakHit) {
			return t("It was indeed {name}. Streaks: {n}", {
				name: truthCountryLabel(result, locale),
				n: String(streak),
			});
		}
		const prior = streakRunBeforeLastRound(rounds, "country");
		if (prior > 0) {
			return t("Your streak ended after correctly guessing {n} countries in a row.", {
				n: String(prior),
			});
		}
		return t("You guessed {guess}, the correct answer is {correct}. Streaks: 0", {
			guess: guessCountryLabel(result, locale),
			correct: truthCountryLabel(result, locale),
		});
	}

	if (result.stateStreakHit === null) return null;
	if (result.stateStreakHit) {
		return t("It was indeed {name}. Streaks: {n}", {
			name: truthStateLabel(result, locale),
			n: String(stateStreak),
		});
	}
	const prior = streakRunBeforeLastRound(rounds, "state");
	if (prior > 0) {
		return t("Your streak ended after correctly guessing {n} states in a row.", {
			n: String(prior),
		});
	}
	return t("You guessed {guess}, the correct answer is {correct}. Streaks: 0", {
		guess: guessStateLabel(result, locale),
		correct: truthStateLabel(result, locale),
	});
}
