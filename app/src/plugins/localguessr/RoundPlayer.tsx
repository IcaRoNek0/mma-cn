import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import {
	mdiClose,
	mdiHome,
	mdiFlagCheckered,
	mdiCar,
	mdiCarOff,
	mdiFlagPlusOutline,
	mdiCog,
	mdiUndo,
} from "@mdi/js";
import { Tooltip } from "@/components/primitives/Tooltip";
import { Dialog, DialogContent, DialogActions } from "@/components/primitives/Dialog";
import { useT } from "@/lib/i18n";
import { getSettings, setSetting, useSettings } from "@/store/settings";
import { getPanorama } from "@/lib/sv/panoSingleton";
import { tweenPov } from "@/lib/sv/tweenPov";
import type { LatLng } from "@/types";
import {
	currentRoundLocation,
	isLastRound,
	totalRoundsLabel,
	type ActiveGame,
	type RoundResult,
	resolveCountryName,
} from "./GameState";
import { scoreForGuess } from "./ScoreUtils";
import { checkStreakHit, reverseGeocodePlace } from "./streakValidator";
import { GamePanoView, type GamePanoHandle } from "./GamePanoView";
import { GameTimer } from "./GameTimer";
import { GuessMap } from "./GuessMap";
import { ResultOverlay } from "./ResultOverlay";
import type { PsvPanoramaController } from "@/lib/sv/panoSingleton";
import { emit } from "@/lib/events";

export function RoundPlayer({
	active,
	onResult,
	onNext,
	onFinish,
	onAbort,
}: {
	active: ActiveGame;
	onResult: (result: RoundResult) => void;
	onNext: () => void;
	onFinish: () => void;
	onAbort: (patch?: Partial<ActiveGame>) => void;
}) {
	const { t, locale } = useT();
	const round = currentRoundLocation(active);
	const panoRef = useRef<GamePanoHandle | null>(null);
	const [panorama, setPanorama] = useState<PsvPanoramaController | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [localGuess, setLocalGuess] = useState<LatLng | null>(null);
	const [hideCar, setHideCar] = useState(!getSettings().showCar);
	const [hideCarSupported, setHideCarSupported] = useState(true);
	const [hasCheckpoint, setHasCheckpoint] = useState(false);
	const [canUndo, setCanUndo] = useState(false);
	const [confirmEndOpen, setConfirmEndOpen] = useState(false);
	const [mapSize, setMapSize] = useState(2);
	const [sticky, setSticky] = useState(false);
	const showResult = active.phase === "result";
	const lastResult = active.rounds[active.rounds.length - 1] ?? null;
	const streakMode = active.config.streakMode;
	const streakOn = streakMode !== "off";
	const hudStreak = streakMode === "state" ? active.stateStreak : active.streak;
	const isInfinite = active.config.roundMode === "infinite";

	const cancelTweenRef = useRef<(() => void) | null>(null);
	// Reset local round UI (guess, undo, checkpoint) on session/round/phase change.
	const sectionChange = `${active.sessionId}:${active.currentRoundIndex}:${showResult ? "r" : "p"}`;

	const applyHideCar = useCallback((hide: boolean) => {
		// Google + Baidu/Tencent inject share the Google material pipeline.
		// PSV (Apple/Yandex) must not receive NO_CAR — it corrupts their WebGL shaders.
		// Baidu rotation (020/050 rigs) is auto-detected inside sendHideCar itself.
		void hide;
	}, []);

	const toggleHideCar = useCallback(() => {
		const next = !hideCar;
		setHideCar(next);
		setSetting("showCar", !next);
		applyHideCar(next);
	}, [hideCar, applyHideCar]);

	useEffect(() => {
		setHideCarSupported(false);
	}, [panorama, hideCar, applyHideCar, round?.id]);

	useEffect(() => {
		return () => {
			/* PSV has no Google car shader to toggle. */
		};
	}, []);

	useEffect(() => {
		setLocalGuess(null);
		setSubmitting(false);
		setSticky(false);
		setHasCheckpoint(false);
		setCanUndo(false);
		setConfirmEndOpen(false);
	}, [sectionChange]);

	const abortWithGuess = useCallback(() => {
		onAbort({ guess: localGuess ?? active.guess });
	}, [onAbort, localGuess, active.guess]);

	const requestClose = useCallback(() => {
		if (isInfinite) {
			setConfirmEndOpen(true);
			return;
		}
		abortWithGuess();
	}, [isInfinite, abortWithGuess]);

	const confirmEndGame = useCallback(() => {
		setConfirmEndOpen(false);
		onFinish();
	}, [onFinish]);

	const confirmExitGame = useCallback(() => {
		setConfirmEndOpen(false);
		abortWithGuess();
	}, [abortWithGuess]);

	const submitGuess = useCallback(
		async (guess: LatLng | null) => {
			if (!round || submitting || showResult) return;
			setSubmitting(true);
			try {
				const { distanceMeters, score } = scoreForGuess(
					guess,
					{ lat: round.lat, lng: round.lng },
					active.maxErrorDistance,
				);

				const [truthPlace, guessPlace] = await Promise.all([
					reverseGeocodePlace(round.lat, round.lng, active.config.geocodeBackend, locale),
					guess
						? reverseGeocodePlace(guess.lat, guess.lng, active.config.geocodeBackend, locale)
						: Promise.resolve(null),
				]);

				const streakResult = checkStreakHit(streakMode, truthPlace, guessPlace);
				const countryName = resolveCountryName(
					truthPlace?.countryCode ?? null,
					truthPlace?.countryName ?? null,
					locale,
				);
				const guessCountryName = guessPlace
					? resolveCountryName(guessPlace.countryCode, guessPlace.countryName, locale)
					: null;

				const result: RoundResult = {
					location: round,
					guess,
					distanceMeters,
					score,
					countryCode: truthPlace?.countryCode ?? null,
					countryName,
					admin: truthPlace?.admin ?? null,
					guessCountryCode: guessPlace?.countryCode ?? null,
					guessCountryName,
					guessAdmin: guessPlace?.admin ?? null,
					streakHit: streakMode === "country" ? streakResult.country : null,
					stateStreakHit: streakMode === "state" ? streakResult.state : null,
					elapsedMs: Date.now() - active.roundStartedAt,
				};
				onResult(result);
			} finally {
				setSubmitting(false);
			}
		},
		[round, submitting, showResult, active, onResult, streakMode],
	);

	// ── LocalGuessr fixed hotkeys (not configurable in app settings) ──
	const LG = {
		checkpoint: "c",
		returnCheckpoint: "b",
		undoMove: "z",
		closeGame: "Escape",
		openSettings: "Tab",
		hideCar: "h",
		pointNorth: "n",
		returnToSpawn: "r",
	} as const;

	const hotkeyLabel = useCallback(
		(label: string, key: string) => (key ? `${label} (${key})` : label),
		[],
	);

	const movementMode = active.config.movementMode;
	const canMove = movementMode === "moving";

	// Single keydown handler for all LocalGuessr hotkeys — blocks propagation
	// to app-level listeners (useCommandHotkeys, etc.) via stopImmediatePropagation.
	useEffect(() => {
		const isInput = (el: EventTarget | null) => {
			if (!(el instanceof HTMLElement)) return false;
			const tag = el.tagName;
			return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
		};

		const handler = (e: KeyboardEvent) => {
			if (e.repeat) return;
			if (isInput(e.target)) return;

			const key = e.key;
			const ctrl = e.ctrlKey || e.metaKey;
			const shift = e.shiftKey;
			const alt = e.altKey;

			// Only match bare keys (no modifiers except Shift for Tab).
			if (ctrl || alt) return;

			if (key === LG.checkpoint && !shift) {
				e.preventDefault();
				e.stopImmediatePropagation();
				if (!canMove) return;
				panoRef.current?.setCheckpoint();
				setHasCheckpoint(true);
				return;
			}
			if (key === LG.returnCheckpoint && !shift) {
				e.preventDefault();
				e.stopImmediatePropagation();
				if (!canMove) return;
				panoRef.current?.returnToCheckpoint();
				return;
			}
			if (key === LG.undoMove && !shift) {
				e.preventDefault();
				e.stopImmediatePropagation();
				if (!canMove || !panoRef.current?.canUndoMove()) return;
				panoRef.current.undoMove();
				return;
			}
			if (key === LG.closeGame) {
				e.preventDefault();
				e.stopImmediatePropagation();
				if (confirmEndOpen) {
					setConfirmEndOpen(false);
					return;
				}
				requestClose();
				return;
			}
			if (key === LG.openSettings) {
				e.preventDefault();
				e.stopImmediatePropagation();
				emit("settings:open");
				return;
			}
			if (key === LG.hideCar && !shift) {
				e.preventDefault();
				e.stopImmediatePropagation();
				toggleHideCar();
				return;
			}
			if (key === LG.pointNorth && !shift) {
				e.preventDefault();
				e.stopImmediatePropagation();
				if (active.config.movementMode === "nmpz") return;
				const pano = panoRef.current?.getPanorama() ?? getPanorama();
				if (!pano) return;
				cancelTweenRef.current?.();
				const h = pano.getPov().heading;
				if (Math.abs(h) < 1 && Math.abs(pano.getPov().pitch) < 1) {
					cancelTweenRef.current = tweenPov(pano, { heading: 0, pitch: -90 });
				} else {
					cancelTweenRef.current = tweenPov(pano, { heading: 0, pitch: 0 });
				}
				return;
			}
			if (key === LG.returnToSpawn && !shift) {
				e.preventDefault();
				e.stopImmediatePropagation();
				panoRef.current?.returnToSpawn();
				return;
			}
		};

		document.addEventListener("keydown", handler, true);
		return () => document.removeEventListener("keydown", handler, true);
	}, [canMove, active, localGuess, toggleHideCar, requestClose, confirmEndOpen, t]);

	// Space bar for guess/next (separate from the main handler because it needs
	// different behavior in result phase).
	useEffect(() => {
		let isRepeated = false;
		function handleKeyDown(e: KeyboardEvent) {
			if (isRepeated) {
				isRepeated = false;
				return;
			}
			if (e.repeat) return;
			const target = e.target as HTMLElement;
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT"
			)
				return;

			if (e.code === "Space") {
				e.preventDefault();
				e.stopImmediatePropagation();
				if (showResult) {
					if (isLastRound(active) && active.config.roundMode === "classic") {
						onFinish();
					} else {
						onNext();
					}
				} else {
					void submitGuess(localGuess);
				}
				return;
			}
		}
		function onKeyDown(e: KeyboardEvent) {
			handleKeyDown(e);
		}
		function onKeyUp() {
			isRepeated = false;
		}
		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("keyup", onKeyUp);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("keyup", onKeyUp);
		};
	}, [showResult, active, localGuess, submitGuess, onNext, onFinish]);

	const { showCompass, showCompassTape } = useSettings();

	if (!round) return null;

	const truth = showResult ? round : null;
	const displayGuess = showResult ? (lastResult?.guess ?? localGuess) : localGuess;
	const cumScore = active.rounds.reduce((s, r) => s + r.score, 0);

	return (
		<div className={`gg-round${showResult ? " gg-round--result" : ""}`}>
			{/* Keep Street View mounted across play↔result to avoid reparenting the
			    shared WebGL canvas (context loss → app-wide white screen). */}
			<div
				className={`gg-pano-wrap${showResult ? " gg-pano-wrap--hidden" : ""}`}
				aria-hidden={showResult}
			>
				<GamePanoView
					ref={panoRef}
					round={round}
					movementMode={movementMode}
					onPanorama={setPanorama}
					onCanUndoChange={setCanUndo}
				/>
				{panorama && showCompassTape && !showResult && (
					<div className="gg-pano-compass" aria-hidden="true" />
				)}
			</div>

			<header className="gg-round__top">
				<div className="gg-status">
					<div className="gg-status__inner">
						<div className="gg-status__item">
							<div className="gg-status__label">{t("MAP")}</div>
							<div className="gg-status__value">{active.mapName}</div>
						</div>
						<div className="gg-status__item">
							<div className="gg-status__label">{t("ROUND")}</div>
							<div className="gg-status__value">
								{active.currentRoundIndex + 1}
								<span className="gg-status__slash">/</span>
								{totalRoundsLabel(active)}
							</div>
						</div>
						<div className="gg-status__item">
							<div className="gg-status__label">{t("SCORE")}</div>
							<div className="gg-status__value">{cumScore.toLocaleString()}</div>
						</div>
						{streakOn && (
							<div className="gg-status__item">
								<div className="gg-status__label">{t("Streak")}</div>
								<div className="gg-status__value">{hudStreak}</div>
							</div>
						)}
						{active.config.timerMode !== "off" && !showResult && (
							<div className="gg-status__item gg-status__item--timer">
								<div className="gg-status__label">{t("Time")}</div>
								<div className="gg-status__value">
									<GameTimer
										embedded
										mode={active.config.timerMode}
										timeLimit={active.config.timeLimit}
										startedAt={active.roundStartedAt}
										running={!showResult && !submitting}
										onExpire={() => void submitGuess(localGuess)}
									/>
								</div>
							</div>
						)}
					</div>
				</div>
			</header>

			<button
				type="button"
				className="gg-round__close"
				onClick={requestClose}
				aria-label={t("Close")}
			>
				<Icon path={mdiClose} />
			</button>

			<Dialog open={confirmEndOpen} onOpenChange={setConfirmEndOpen}>
				<DialogContent title={t("Stop this infinite game?")} className="gg-end-dialog">
					<p className="gg-end-dialog__body">
						{t(
							"End the game to save a finished summary, or exit to keep it in Ongoing and resume later.",
						)}
					</p>
					<DialogActions
						cancel
						primary={{ label: t("End game"), onClick: confirmEndGame }}
						start={<Button onClick={confirmExitGame}>{t("Exit")}</Button>}
					/>
				</DialogContent>
			</Dialog>

			{!showResult && (
				<div className="gg-controls">
					{panorama && showCompass && (
						<div className="gg-controls__compass gg-compass-control-host" aria-hidden="true" />
					)}
					<div className="gg-controls__col">
						{canMove && (
							<>
								<Tooltip content={hotkeyLabel(t("Set checkpoint"), LG.checkpoint)} side="right">
									<button
										type="button"
										className="gg-controls__btn"
										onClick={() => {
											panoRef.current?.setCheckpoint();
											setHasCheckpoint(true);
										}}
										aria-label={t("Set checkpoint")}
									>
										<Icon path={mdiFlagPlusOutline} />
									</button>
								</Tooltip>
								{hasCheckpoint && (
									<Tooltip
										content={hotkeyLabel(t("Return to checkpoint"), LG.returnCheckpoint)}
										side="right"
									>
										<button
											type="button"
											className="gg-controls__btn"
											onClick={() => panoRef.current?.returnToCheckpoint()}
											aria-label={t("Return to checkpoint")}
										>
											<Icon path={mdiFlagCheckered} />
										</button>
									</Tooltip>
								)}
								<Tooltip content={hotkeyLabel(t("Undo move"), LG.undoMove)} side="right">
									<button
										type="button"
										className="gg-controls__btn"
										onClick={() => panoRef.current?.undoMove()}
										disabled={!canUndo}
										aria-label={t("Undo move")}
									>
										<Icon path={mdiUndo} />
									</button>
								</Tooltip>
							</>
						)}
						{canMove && (
							<Tooltip content={hotkeyLabel(t("Return to spawn"), LG.returnToSpawn)} side="right">
								<button
									type="button"
									className="gg-controls__btn"
									onClick={() => panoRef.current?.returnToSpawn()}
									aria-label={t("Return to spawn")}
								>
									<Icon path={mdiHome} />
								</button>
							</Tooltip>
						)}
						{panorama && hideCarSupported && (
							<Tooltip
								content={hotkeyLabel(hideCar ? t("Show car") : t("Hide car"), LG.hideCar)}
								side="right"
							>
								<button
									type="button"
									className={`gg-controls__btn${hideCar ? " gg-controls__btn--active" : ""}`}
									onClick={toggleHideCar}
									aria-label={hideCar ? t("Show car") : t("Hide car")}
								>
									<Icon path={hideCar ? mdiCarOff : mdiCar} />
								</button>
							</Tooltip>
						)}
						<Tooltip content={hotkeyLabel(t("Open settings"), LG.openSettings)} side="right">
							<button
								type="button"
								className="gg-controls__btn"
								onClick={() => emit("settings:open")}
								aria-label={t("Open settings")}
							>
								<Icon path={mdiCog} />
							</button>
						</Tooltip>
					</div>
				</div>
			)}

			{/* Single persistent GuessMap — play↔result only toggles props/CSS.
			    Remounting created a new MapHost+DeckGL every phase and exhausted
			    the browser WebGL context budget. */}
			<div
				className={showResult ? "gg-round-result" : "gg-guess-map-slot"}
				data-qa={showResult ? "result-layout" : undefined}
			>
				<div
					className={showResult ? "gg-round-result__map" : undefined}
					data-qa={showResult ? "result-view-top" : undefined}
				>
					<GuessMap
						variant={showResult ? "result" : "play"}
						guess={displayGuess}
						truth={truth}
						showResult={showResult}
						/* Keep pan/zoom during result; guess placement is gated by showResult. */
						locked={false}
						mapSize={showResult ? 2 : mapSize}
						sticky={showResult ? false : sticky}
						roundKey={`${active.sessionId}:${active.currentRoundIndex}`}
						onSizeChange={setMapSize}
						onToggleSticky={() => setSticky((v) => !v)}
						onGuess={(p) => {
							if (!showResult) setLocalGuess(p);
						}}
						onSubmit={() => void submitGuess(localGuess)}
						submitting={submitting}
						hasGuess={!!localGuess}
					/>
				</div>
				{showResult && lastResult && (
					<ResultOverlay
						result={lastResult}
						rounds={active.rounds}
						streakMode={streakMode}
						streak={active.streak}
						stateStreak={active.stateStreak}
						isLast={isLastRound(active)}
						onNext={onNext}
						onFinish={onFinish}
					/>
				)}
			</div>
		</div>
	);
}
