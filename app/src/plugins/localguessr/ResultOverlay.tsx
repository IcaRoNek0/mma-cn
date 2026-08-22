import { Button } from "@/components/primitives/Button";
import { useT } from "@/lib/i18n";
import { streakResultMessage } from "./streakCopy";
import { AddTagButton } from "./AddTagButton";
import type { RoundResult, StreakMode } from "./GameState";

function splitDistanceDisplay(meters: number | null): { value: string; unit: string } {
	if (meters == null) return { value: "—", unit: "" };
	if (meters > 1000) {
		return {
			value: Math.round(meters / 1000).toLocaleString(),
			unit: "km",
		};
	}
	return { value: Math.round(meters).toLocaleString(), unit: "m" };
}

/**
 * Round settlement chrome (score / distance / next). The result *map* stays in
 * GuessMap's persistent MapHost; layer/camera helpers live in `resultMapOverlay.ts`
 * so replay and settlement share one truth-pin click path.
 */
export function ResultOverlay({
	result,
	rounds,
	streakMode,
	streak,
	stateStreak,
	isLast,
	onNext,
	onFinish,
}: {
	result: RoundResult;
	rounds: RoundResult[];
	streakMode: StreakMode;
	streak: number;
	stateStreak: number;
	isLast: boolean;
	onNext: () => void;
	onFinish: () => void;
}) {
	const { t, locale } = useT();
	const dist = splitDistanceDisplay(result.distanceMeters);
	const streakMsg =
		streakMode !== "off"
			? streakResultMessage(result, rounds, streakMode, streak, stateStreak, t, locale)
			: null;

	return (
		<div className="gg-round-result__bar" data-qa="result-view-bottom">
			<div className="gg-round-result__bar-inner">
				<div className="gg-round-result__distance">
					<div className="gg-round-result__distance-value">
						<span className="gg-shadow-text gg-shadow-text--positive gg-shadow-text--md">
							{dist.value}
						</span>
						{dist.unit && (
							<span className="gg-shadow-text gg-shadow-text--positive gg-shadow-text--md">
								{dist.unit}
							</span>
						)}
					</div>
					<p className="gg-round-result__label">
						{result.distanceMeters != null ? t("From location") : t("No guess placed")}
					</p>
				</div>

				<div className="gg-round-result__center">
					{streakMsg && <div className="gg-round-result__streak">{streakMsg}</div>}
					<div className="gg-round-result__actions">
						<AddTagButton locationIds={[result.location.id]} variant="result" />
						{isLast ? (
							<Button variant="primary" onClick={onFinish}>
								{t("View summary")}
							</Button>
						) : (
							<Button variant="primary" onClick={onNext}>
								{t("Next round")}
							</Button>
						)}
						<p className="gg-round-result__space">
							{t("Hit")} <span className="gg-kbd">Space</span> {t("to continue")}
						</p>
					</div>
				</div>

				<div className="gg-round-result__points">
					<div className="gg-shadow-text gg-shadow-text--negative gg-shadow-text--md">
						{result.score.toLocaleString()}
					</div>
					<p className="gg-round-result__label">{t("Of {max} points", { max: "5,000" })}</p>
				</div>
			</div>
		</div>
	);
}
