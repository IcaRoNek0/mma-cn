import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/primitives/Button";
import { useT } from "@/lib/i18n";
import { formatDistance } from "./ScoreUtils";
import { formatCountryLabel, type GameSession, type StreakMode } from "./GameState";
import { computeBestStreakForMode } from "./streakValidator";
import { ReplayMap } from "./ReplayMap";
import { AddTagButton } from "./AddTagButton";

export function SummaryView({
	session,
	onPlayAgain,
	onBack,
	onAnalytics,
}: {
	session: GameSession;
	onPlayAgain: () => void;
	onBack: () => void;
	onAnalytics: () => void;
}) {
	const { t, locale } = useT();
	const [highlighted, setHighlighted] = useState<number | null>(null);
	const streakMode = session.config.streakMode as StreakMode;

	useEffect(() => {
		setHighlighted(null);
	}, [session.id]);
	const streakOn = streakMode !== "off";
	const bestStreak = computeBestStreakForMode(session.rounds, streakMode);
	const allLocationIds = useMemo(
		() => session.rounds.map((r) => r.location.id).filter((id) => Number.isFinite(id)),
		[session.rounds],
	);

	return (
		<div className="gg-summary">
			<div className="gg-summary__hero">
				<div className="gg-summary__hero-main">
					<div className="gg-summary__label">{t("Game Breakdown")}</div>
					<div className="gg-summary__score">{session.totalScore.toLocaleString()}</div>
				</div>
				<div className="gg-summary__hero-meta">
					{streakOn && (
						<div className="gg-summary__streak">
							{t("Best streak")}: {bestStreak}
						</div>
					)}
					<div className="gg-summary__map">{session.mapName}</div>
				</div>
			</div>

			<div className="gg-summary__body">
				<ReplayMap rounds={session.rounds} highlighted={highlighted} />

				<div className="gg-summary__rounds">
					{session.rounds.map((r, i) => (
						<div
							key={i}
							className={`gg-summary__row${highlighted === i ? " is-active" : ""}`}
							onClick={() => setHighlighted(highlighted === i ? null : i)}
						>
							<span className="gg-summary__row-n">#{i + 1}</span>
							<span className="gg-summary__row-score">{r.score.toLocaleString()}</span>
							<span className="gg-summary__row-dist">
								{r.distanceMeters != null ? formatDistance(r.distanceMeters) : "—"}
							</span>
							<span
								className="gg-summary__row-place"
								dangerouslySetInnerHTML={{
									__html: formatCountryLabel(r.countryCode, r.countryName, r.admin, locale) || "—",
								}}
							/>
							{streakOn && streakMode === "country" && (
								<span className={`gg-summary__row-streak${r.streakHit ? " is-hit" : " is-miss"}`}>
									{t("Streak")} {r.streakHit ? "✓" : "✗"}
								</span>
							)}
							{streakOn && streakMode === "state" && (
								<span
									className={`gg-summary__row-streak${r.stateStreakHit ? " is-hit" : " is-miss"}`}
								>
									{t("Streak")} {r.stateStreakHit ? "✓" : "✗"}
								</span>
							)}
							<span className="gg-summary__row-tag">
								<AddTagButton locationIds={[r.location.id]} variant="summary-row" />
							</span>
						</div>
					))}
				</div>
			</div>

			<div className="gg-summary__actions">
				<AddTagButton locationIds={allLocationIds} variant="summary-bulk" />
				<Button variant="primary" onClick={onPlayAgain}>
					{t("Play again")}
				</Button>
				<Button onClick={onAnalytics}>{t("Analytics")}</Button>
				<Button onClick={onBack}>{t("Back")}</Button>
			</div>
		</div>
	);
}
