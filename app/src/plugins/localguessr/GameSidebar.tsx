import { EmptyState } from "@/components/primitives/EmptyState";
import { useEffect, useState } from "react";
import { Sidebar, Section, Field, SegmentedControl } from "@/components/primitives/Sidebar";
import { Button } from "@/components/primitives/Button";
import { Slider } from "@/components/primitives/Slider";
import { NSelect } from "@/components/primitives/NSelect";
import { TextInput } from "@/components/primitives/TextInput";
import { usePluginState } from "@/plugins/pluginStorage";
import { useMapState } from "@/store/useMapStore";
import { useT } from "@/lib/i18n";
import { Icon } from "@/components/primitives/Icon";
import { mdiEarth, mdiPlayCircleOutline, mdiDeleteOutline, mdiContentCopy, mdiCog } from "@mdi/js";
import { emit } from "@/lib/events";
import { toast } from "@/lib/util/toast";
import {
	DEFAULT_GAME_CONFIG,
	normalizeStreakMode,
	type GameConfig,
	type GeocodeBackend,
	type MovementMode,
	type RoundMode,
	type StreakMode,
	type TimerMode,
} from "./GameState";
import { GameOverlay, useGameController } from "./GameRunner";
import { getSessions } from "./gameSessionStore";
import { deleteOngoingGame, getOngoingGames, type OngoingGameRecord } from "./ongoingGameStore";
import "./geoguessr.css";

function formatStartedAt(ms: number): string {
	try {
		return new Date(ms).toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return "";
	}
}

export function GameSidebar({ onClose }: { onClose: () => void }) {
	const { t } = useT();
	const [stored, setStored] = usePluginState<Partial<GameConfig>>(
		"localguessr",
		"config",
		DEFAULT_GAME_CONFIG,
	);
	const config: GameConfig = {
		...DEFAULT_GAME_CONFIG,
		...stored,
		movementMode:
			stored?.movementMode === "moving" || stored?.movementMode === "nmpz"
				? stored.movementMode
				: "no-move",
		streakMode: normalizeStreakMode(stored?.streakMode as string | undefined),
		maxDistance:
			typeof stored?.maxDistance === "number" && stored.maxDistance > 0 ? stored.maxDistance : null,
	};
	const map = useMapState((s) => s.map);
	const locationCount = useMapState((s) => s.locationCount);
	const controller = useGameController(config);
	const [ongoingGames, setOngoingGames] = useState<OngoingGameRecord[]>([]);

	const refreshOngoing = () => {
		setOngoingGames(getOngoingGames());
	};

	useEffect(() => {
		refreshOngoing();
	}, [controller.state.phase, controller.state.active?.sessionId]);

	useEffect(() => {
		controller.setConfig(config);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		config.movementMode,
		config.roundMode,
		config.classicRounds,
		config.timerMode,
		config.timeLimit,
		config.streakMode,
		config.geocodeBackend,
		config.maxDistance,
	]);

	const patch = (p: Partial<GameConfig>) => {
		setStored((prev) => ({ ...DEFAULT_GAME_CONFIG, ...prev, ...p }));
	};

	const inGame =
		controller.state.phase === "playing" ||
		controller.state.phase === "result" ||
		controller.state.phase === "summary" ||
		controller.state.phase === "analytics";
	const pastGames = getSessions().length;
	const currentPanoId =
		controller.state.active?.locations[controller.state.active.currentRoundIndex]?.panoId ?? null;
	const copyPanoId = async () => {
		if (!currentPanoId || !navigator.clipboard) return;
		await navigator.clipboard.writeText(currentPanoId);
		toast(t("Pano ID copied"));
	};

	return (
		<>
			<Sidebar title={t("LocalGuessr")} onBack={onClose} className="gg-plugin-sidebar">
				{!map ? (
					<EmptyState icon={mdiEarth}>{t("Open a map to play")}</EmptyState>
				) : (
					<>
						<Section title={t("Map pool")}>
							<Field label={t("Current map")}>
								<div className="gg-sidebar__map-name">{map.name}</div>
							</Field>
							<Field label={t("Locations in pool")}>
								<div>{locationCount.toLocaleString()}</div>
							</Field>
						</Section>

						<Section title={t("Ongoing games")}>
							{ongoingGames.length === 0 ? (
								<p className="gg-sidebar__ongoing-empty">{t("No unfinished games yet.")}</p>
							) : (
								ongoingGames.map((g) => {
									const isCurrent = controller.state.active?.sessionId === g.sessionId;
									const roundsDone = g.active.rounds.length;
									const roundLabel =
										g.active.phase === "result"
											? `${roundsDone}/${g.active.locations.length}`
											: `${g.active.currentRoundIndex + 1}/${g.active.locations.length}`;
									return (
										<div
											key={g.sessionId}
											className={`gg-sidebar__ongoing-row${isCurrent ? " is-current" : ""}`}
										>
											<span className="gg-sidebar__ongoing-map" title={g.mapName}>
												{g.mapName}
											</span>
											<span className="gg-sidebar__ongoing-meta">
												<span className="gg-sidebar__ongoing-mode">
													{g.active.config.movementMode}
												</span>
												<span className="gg-sidebar__ongoing-sep">·</span>
												<span className="gg-sidebar__ongoing-rounds">{roundLabel}</span>
												<span className="gg-sidebar__ongoing-sep">·</span>
												<span className="gg-sidebar__ongoing-time">
													{formatStartedAt(g.startedAt)}
												</span>
											</span>
											<span className="gg-sidebar__ongoing-actions">
												<button
													type="button"
													className="gg-sidebar__ongoing-icon-btn"
													disabled={inGame}
													onClick={() => {
														const active = {
															...g.active,
															config: {
																...g.active.config,
																streakMode: normalizeStreakMode(
																	g.active.config.streakMode as string,
																),
															},
															gameStartedAt: g.active.gameStartedAt ?? g.startedAt,
														};
														controller.resumeGame(active);
													}}
													aria-label={t("Resume game")}
												>
													<Icon path={mdiPlayCircleOutline} size={18} />
												</button>
												<button
													type="button"
													className="gg-sidebar__ongoing-icon-btn"
													onClick={() => {
														deleteOngoingGame(g.sessionId);
														refreshOngoing();
													}}
													aria-label={t("Delete")}
												>
													<Icon path={mdiDeleteOutline} size={18} />
												</button>
											</span>
										</div>
									);
								})
							)}
						</Section>

						<Section title={t("Game mode")}>
							<Field label={t("Movement")}>
								<SegmentedControl<MovementMode>
									value={config.movementMode}
									onChange={(movementMode) => patch({ movementMode })}
									options={[
										{ value: "moving", label: t("Moving") },
										{ value: "no-move", label: t("No Move") },
										{ value: "nmpz", label: t("NMPZ") },
									]}
								/>
							</Field>

							<Field label={t("Rounds")}>
								<SegmentedControl<RoundMode>
									value={config.roundMode}
									onChange={(roundMode) => patch({ roundMode })}
									options={[
										{ value: "classic", label: t("Classic") },
										{ value: "infinite", label: t("Infinite") },
									]}
								/>
							</Field>

							{config.roundMode === "classic" && (
								<Field
									label={t("Rounds ({n})", {
										n: String(config.classicRounds),
									})}
								>
									<Slider
										min={1}
										max={10}
										step={1}
										value={config.classicRounds}
										onChange={(e) => patch({ classicRounds: Number(e.target.value) })}
									/>
								</Field>
							)}
						</Section>

						<Section title={t("Timer")} collapsible>
							<Field label={t("Timer mode")}>
								<NSelect
									value={config.timerMode}
									onChange={(e) => patch({ timerMode: e.target.value as TimerMode })}
								>
									<option value="off">{t("Off")}</option>
									<option value="countdown">{t("Countdown")}</option>
									<option value="countup">{t("Count up")}</option>
								</NSelect>
							</Field>
							{config.timerMode === "countdown" && (
								<Field
									label={t("Time limit ({n}s)", {
										n: String(config.timeLimit),
									})}
								>
									<Slider
										min={15}
										max={300}
										step={5}
										value={config.timeLimit}
										onChange={(e) => patch({ timeLimit: Number(e.target.value) })}
									/>
								</Field>
							)}
						</Section>

						<Section title={t("Scoring")} collapsible>
							<Field label={t("Max distance")}>
								<TextInput
									type="number"
									min={1}
									step={1}
									placeholder={t("Map default")}
									value={config.maxDistance ?? ""}
									onChange={(e) => {
										const value = e.target.value.trim();
										patch({ maxDistance: value === "" ? null : Math.max(1, Number(value)) });
									}}
								/>
							</Field>
						</Section>

						<Section title={t("Streak")} collapsible>
							<Field label={t("Streak mode")}>
								<NSelect
									value={config.streakMode}
									onChange={(e) => patch({ streakMode: e.target.value as StreakMode })}
								>
									<option value="off">{t("Off")}</option>
									<option value="country">{t("Country")}</option>
									<option value="state">{t("State / Province")}</option>
								</NSelect>
							</Field>
							{config.streakMode !== "off" && (
								<>
									<Field label={t("Reverse geocode")}>
										<SegmentedControl<GeocodeBackend>
											value={config.geocodeBackend}
											onChange={(geocodeBackend) => patch({ geocodeBackend })}
											options={[
												{
													value: "local",
													label: t("Local"),
												},
												{
													value: "nominatim",
													label: t("Nominatim"),
												},
											]}
										/>
									</Field>
								</>
							)}
						</Section>

						<div className="gg-sidebar__actions">
							<Button variant="ghost" onClick={() => emit("settings:open")}>
								<Icon path={mdiCog} size={16} />
								{t("Settings")}
							</Button>
							<Button variant="ghost" disabled={!currentPanoId} onClick={() => void copyPanoId()}>
								<Icon path={mdiContentCopy} size={16} />
								{t("Copy panoId")}
							</Button>
							<Button
								variant="primary"
								disabled={locationCount === 0 || inGame}
								onClick={() => void controller.startGame()}
							>
								{t("Start game")}
							</Button>
							<Button variant="ghost" onClick={() => controller.showAnalytics()}>
								{t("Analytics")}
								{pastGames > 0 ? ` (${pastGames})` : ""}
							</Button>
						</div>
					</>
				)}
			</Sidebar>
			<GameOverlay controller={controller} />
		</>
	);
}
