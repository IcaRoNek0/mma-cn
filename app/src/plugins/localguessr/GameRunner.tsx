/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { query, getMapState } from "@/store/useMapStore";
import { toast } from "@/lib/util/toast";
import { useT } from "@/lib/i18n";
import {
	createActiveGame,
	isLastRound,
	pickRandomLocations,
	toFinishedSession,
	useGameReducer,
	type ActiveGame,
	type GameConfig,
	type RoundResult,
} from "./GameState";
import type { GameSession } from "./GameState";
import { resolveMapMaxError } from "./ScoreUtils";
import { saveSession } from "./gameSessionStore";
import { saveOngoingGame, deleteOngoingGame, type OngoingGameRecord } from "./ongoingGameStore";
import { RoundPlayer } from "./RoundPlayer";
import { SummaryView } from "./SummaryView";
import { AnalyticsPage } from "./analytics/AnalyticsPage";

const INFINITE_BATCH = 50;

export function useGameController(storedConfig?: Partial<GameConfig>) {
	const { t } = useT();
	const { state, dispatch, setConfig } = useGameReducer(storedConfig);

	useEffect(() => {
		if (storedConfig) setConfig(storedConfig);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		const active = state.active;
		if (!active) return;
		const record: OngoingGameRecord = {
			sessionId: active.sessionId,
			mapId: active.mapId,
			mapName: active.mapName,
			startedAt: active.gameStartedAt,
			active,
		};
		saveOngoingGame(record);
	}, [state.active]);

	const startGame = useCallback(async () => {
		const map = getMapState().map;
		if (!map) {
			toast(t("Open a map to play"));
			return;
		}
		const all = await query({ type: "Everything" }).locations();
		if (all.length === 0) {
			toast(t("This map has no locations"));
			return;
		}

		const count =
			state.config.roundMode === "classic"
				? Math.min(state.config.classicRounds, all.length)
				: Math.min(INFINITE_BATCH, all.length);
		const locations = pickRandomLocations(all, count);
		const maxErrorDistance =
			state.config.maxDistance != null && state.config.maxDistance > 0
				? state.config.maxDistance
				: resolveMapMaxError(
						map.scoreBounds,
						locations.map((l) => ({ lat: l.lat, lng: l.lng })),
					);

		const active = createActiveGame({
			mapId: map.id,
			mapName: map.name,
			config: state.config,
			maxErrorDistance,
			locations,
		});
		dispatch({ type: "START", active });
	}, [state.config, dispatch, t]);

	const resumeGame = useCallback(
		(active: ActiveGame) => {
			dispatch({ type: "RESUME", active });
		},
		[dispatch],
	);

	const onResult = useCallback(
		(result: RoundResult) => {
			dispatch({ type: "SHOW_RESULT", result });
		},
		[dispatch],
	);

	const onNext = useCallback(() => {
		if (!state.active) return;
		const nextIndex = state.active.currentRoundIndex + 1;

		if (
			state.active.config.roundMode === "infinite" &&
			nextIndex >= state.active.locations.length
		) {
			void (async () => {
				const all = await query({ type: "Everything" }).locations();
				const more = pickRandomLocations(all, INFINITE_BATCH);
				dispatch({ type: "EXTEND_LOCATIONS", locations: more });
				dispatch({
					type: "NEXT_ROUND",
					nextIndex,
					nextLocationReadyAt: Date.now(),
				});
			})();
			return;
		}

		dispatch({
			type: "NEXT_ROUND",
			nextIndex,
			nextLocationReadyAt: Date.now(),
		});
	}, [state.active, dispatch]);

	const finishFromActive = useCallback(() => {
		if (!state.active) return;
		deleteOngoingGame(state.active.sessionId);
		const session = toFinishedSession(state.active, state.active.rounds);
		saveSession(session);
		dispatch({ type: "FINISH", session });
	}, [state.active, dispatch]);

	const onFinish = useCallback(() => {
		finishFromActive();
	}, [finishFromActive]);

	/** After showing result on last classic round — finish. */
	const onNextOrFinish = useCallback(() => {
		if (!state.active) return;
		if (isLastRound(state.active) && state.active.config.roundMode === "classic") {
			finishFromActive();
		} else {
			onNext();
		}
	}, [state.active, finishFromActive, onNext]);

	const pauseGame = useCallback(
		(patch?: Partial<ActiveGame>) => {
			if (state.active) {
				const active = { ...state.active, ...patch };
				saveOngoingGame({
					sessionId: active.sessionId,
					mapId: active.mapId,
					mapName: active.mapName,
					startedAt: active.gameStartedAt,
					active,
				});
			}
			dispatch({ type: "ABORT" });
		},
		[state.active, dispatch],
	);

	const abort = pauseGame;

	return {
		state,
		dispatch,
		setConfig,
		startGame,
		resumeGame,
		onResult,
		onNext: onNextOrFinish,
		onFinish,
		abort,
		showAnalytics: () => dispatch({ type: "SHOW_ANALYTICS" }),
		showReplay: (s: GameSession) => dispatch({ type: "SHOW_REPLAY", session: s }),
		backToConfig: () => dispatch({ type: "BACK_TO_CONFIG" }),
	};
}

export function GameOverlay({ controller }: { controller: ReturnType<typeof useGameController> }) {
	const {
		state,
		onResult,
		onNext,
		onFinish,
		abort,
		showAnalytics,
		showReplay,
		backToConfig,
		startGame,
	} = controller;

	if (state.phase === "config") return null;

	const mapId = getMapState().map?.id ?? null;

	const content =
		state.phase === "playing" || state.phase === "result" ? (
			state.active && (
				<RoundPlayer
					active={state.active}
					onResult={onResult}
					onNext={onNext}
					onFinish={onFinish}
					onAbort={abort}
				/>
			)
		) : state.phase === "summary" && state.lastSession ? (
			<div className="gg-overlay__panel">
				<SummaryView
					session={state.lastSession}
					onPlayAgain={() => void startGame()}
					onBack={backToConfig}
					onAnalytics={showAnalytics}
				/>
			</div>
		) : state.phase === "replay" && state.lastSession ? (
			<div className="gg-overlay__panel">
				<SummaryView
					session={state.lastSession}
					onPlayAgain={() => void startGame()}
					onBack={backToConfig}
					onAnalytics={showAnalytics}
				/>
			</div>
		) : state.phase === "analytics" ? (
			<div className="gg-overlay__panel">
				<AnalyticsPage mapId={mapId} onBack={backToConfig} onReplaySession={showReplay} />
			</div>
		) : null;

	if (!content) return null;

	return createPortal(
		<div className="gg-overlay" role="dialog" aria-modal="true">
			{content}
		</div>,
		document.body,
	);
}
