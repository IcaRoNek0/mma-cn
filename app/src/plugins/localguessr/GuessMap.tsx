import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/primitives/Icon";
import {
	mdiArrowTopLeft,
	mdiMinus,
	mdiPin,
	mdiPlus,
	mdiArrowBottomRight,
	mdiLayers,
} from "@mdi/js";
import {
	createMapHost,
	hostInstance,
	hostKindForMapType,
	type MapHost,
	type DeckOverlayHandle,
} from "@/lib/map/host";
import { CUSTOM_STYLES_KEY, type CustomStyle } from "@/lib/geo/mapStack";
import { google } from "@/lib/sv/opensv";
import type { MapMouseEvent } from "maplibre-gl";
import { useLocalStorage, getLocal } from "@/lib/hooks/useLocalStorage";
import { type MapEmbedPrefs, DEFAULT_PREFS } from "@/store/mapEmbedPrefs";
import { cmd } from "@/lib/commands";
import type { LatLng, MapTypeKey } from "@/types";
import { useT } from "@/lib/i18n";
import { createGuessPinLayer } from "./guessMapLayers";
import { applyRoundResultOverlay, fitRoundResultCamera } from "./resultMapOverlay";
import type { RoundLocation } from "./GameState";

const MIN_SIZE = 1;
const MAX_SIZE = 4;
const MIN_ZOOM = 1;
const ACTIVE_LEAVE_DELAY_MS = 300;
const GUESS_MAP_TYPES: MapTypeKey[] = ["map"];
const MAP_TYPE_LABEL_KEYS: Record<MapTypeKey, string> = {
	map: "Map",
	satellite: "Satellite",
	osm: "OSM",
	vector: "Vector",
};

function pointInGuessMapPanel(root: HTMLElement | null, x: number, y: number): boolean {
	if (!root) return false;
	const hit = document.elementFromPoint(x, y);
	return hit != null && root.contains(hit);
}

function useGuessMapHost(
	containerRef: React.RefObject<HTMLDivElement | null>,
	guessPrefs: MapEmbedPrefs,
	locked: boolean | undefined,
	showResult: boolean,
	roundKey: string | undefined,
	onGuess: (p: LatLng) => void,
	onZoom: (zoom: number) => void,
) {
	const hostRef = useRef<MapHost | null>(null);
	const overlayRef = useRef<DeckOverlayHandle | null>(null);
	const divRef = useRef<HTMLDivElement | null>(null);
	const [ready, setReady] = useState(false);
	const onGuessRef = useRef(onGuess);
	onGuessRef.current = onGuess;
	// Persist camera across engine-kind changes (Google ↔ MapLibre) so the user's
	// view center and zoom survive a full host destroy / recreate cycle.
	const savedCameraRef = useRef<{ center: LatLng; zoom: number } | null>(null);

	// Key the host-creation effect by the engine *kind* rather than the concrete
	// map type. Google Maps hosts (map, satellite, osm) share one instance and
	// switch styles via applyPrefs instead of destroying / recreating.
	const hostKind = hostKindForMapType(guessPrefs.mapType);

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let cancelled = false;

		void (async () => {
			const kind = hostKind;
			const div = document.createElement("div");
			div.className = "gg-guess-map__host-mount";
			div.style.cssText = "position:absolute;inset:0";
			container.appendChild(div);
			divRef.current = div;

			try {
				// Prefer a camera that was saved from the previous host instance;
				// fall back to the world default on first mount.
				const camera = savedCameraRef.current ?? {
					center: { lat: 20, lng: 0 },
					zoom: 1.5,
				};
				const host = await createMapHost(kind, div, guessPrefs, {
					customStyles: getLocal<CustomStyle[]>(CUSTOM_STYLES_KEY, []),
					camera,
					scaleControl: false,
				});
				if (cancelled) {
					host.destroy();
					return;
				}
				hostRef.current = host;
				const overlay = host.createDeckOverlay();
				overlayRef.current = overlay;
				setReady(true);

				// Fit to app-map bounds only on first mount (no saved camera).
				// After a kind-switch we restore the saved camera so the user
				// sees the same area they were just looking at.
				if (!showResult && !savedCameraRef.current) {
					cmd
						.storeBounds(false)
						.then((bounds) => {
							if (cancelled || !hostRef.current || !bounds) return;
							hostRef.current.fitBounds(
								{
									west: bounds[0],
									south: bounds[1],
									east: bounds[2],
									north: bounds[3],
								},
								undefined,
								{ snap: true },
							);
						})
						.catch(() => {
							/* fell back to default camera */
						});
				}
			} catch {
				if (!cancelled) setReady(false);
			}
		})();

		return () => {
			cancelled = true;
			// Save camera state so the next host (even a different engine) picks
			// up where the user left off.
			if (hostRef.current) {
				const center = hostRef.current.getCenter();
				if (center) {
					savedCameraRef.current = {
						center,
						zoom: hostRef.current.getZoom(),
					};
				}
			}
			overlayRef.current?.finalize();
			overlayRef.current = null;
			hostRef.current?.destroy();
			hostRef.current = null;
			if (divRef.current && container.contains(divRef.current)) {
				container.removeChild(divRef.current);
			}
			divRef.current = null;
			setReady(false);
		};
	}, [
		hostKind,
		guessPrefs.mapStyleName,
		guessPrefs.vectorStyleName,
		guessPrefs.showTerrain,
		guessPrefs.showLabels,
		// Intentionally omit showResult — toggling play↔result must not recreate
		// the MapHost / DeckGL WebGL contexts (browser limit → white screens).
	]);

	// When mapType (or other prefs) changes but the engine kind stays the same
	// (map ↔ satellite ↔ osm all share one Google Maps instance), just apply
	// prefs in-place instead of destroying / recreating.
	useEffect(() => {
		const host = hostRef.current;
		if (!host || !ready) return;
		if (hostKindForMapType(guessPrefs.mapType) !== host.kind) return;
		host.applyPrefs(guessPrefs, {
			customStyles: getLocal<CustomStyle[]>(CUSTOM_STYLES_KEY, []),
		});
	}, [guessPrefs.mapType, ready]);

	useEffect(() => {
		hostRef.current?.setDraggable(!locked);
		hostRef.current?.setCursor(locked || showResult ? null : "crosshair");
	}, [locked, showResult]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host || !ready) return;

		const gmap = hostInstance(host, "google");
		if (gmap) {
			const listener = gmap.addListener("click", (e: google.maps.MapMouseEvent) => {
				if (locked || showResult) return;
				const ll = e.latLng;
				if (!ll) return;
				onGuessRef.current({ lat: ll.lat(), lng: ll.lng() });
			});
			return () => {
				google.maps.event.removeListener(listener);
			};
		}

		const ml = hostInstance(host, "maplibre");
		if (ml) {
			const onClick = (e: MapMouseEvent) => {
				if (locked || showResult) return;
				onGuessRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
			};
			ml.on("click", onClick);
			return () => {
				ml.off("click", onClick);
			};
		}
	}, [ready, locked, showResult]);

	// Zoom sync + camera persistence: whenever zoom changes, push the value
	// upstream and snapshot the full camera position so it survives host swaps.
	useEffect(() => {
		const host = hostRef.current;
		if (!host || !ready) return;
		const update = () => {
			const z = host.getZoom();
			const c = host.getCenter();
			onZoom(z);
			if (c) savedCameraRef.current = { center: c, zoom: z };
		};
		update();
		return host.on("zoom", update);
	}, [ready, hostRef, onZoom]);

	// New round: drop the previous result/play camera and refit the play map.
	useEffect(() => {
		if (!roundKey || showResult) return;
		savedCameraRef.current = null;
		const host = hostRef.current;
		if (!host || !ready) return;
		let cancelled = false;
		cmd
			.storeBounds(false)
			.then((bounds) => {
				if (cancelled || !hostRef.current) return;
				if (bounds) {
					hostRef.current.fitBounds(
						{
							west: bounds[0],
							south: bounds[1],
							east: bounds[2],
							north: bounds[3],
						},
						undefined,
						{ snap: true },
					);
				} else {
					hostRef.current.moveCamera({ center: { lat: 20, lng: 0 }, zoom: 1.5 });
				}
			})
			.catch(() => {
				if (cancelled || !hostRef.current) return;
				hostRef.current.moveCamera({ center: { lat: 20, lng: 0 }, zoom: 1.5 });
			});
		return () => {
			cancelled = true;
		};
	}, [roundKey, showResult, ready]);

	return { hostRef, overlayRef, ready };
}

export function GuessMap({
	variant,
	guess,
	truth,
	showResult,
	locked,
	mapSize,
	sticky,
	roundKey,
	onSizeChange,
	onToggleSticky,
	onGuess,
	onSubmit,
	submitting,
	hasGuess,
}: {
	variant: "play" | "result";
	guess: LatLng | null;
	/** Answer location for the result phase (needed for Street View links). */
	truth: RoundLocation | null;
	showResult: boolean;
	locked?: boolean;
	mapSize: number;
	sticky: boolean;
	/** Changes when a new round starts — resets camera away from the previous result view. */
	roundKey?: string;
	onSizeChange: (size: number) => void;
	onToggleSticky: () => void;
	onGuess: (p: LatLng) => void;
	onSubmit?: () => void;
	submitting?: boolean;
	hasGuess?: boolean;
}) {
	const { t } = useT();
	const containerRef = useRef<HTMLDivElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const [prefs] = useLocalStorage<MapEmbedPrefs>("mapEmbedPrefs", DEFAULT_PREFS);
	const guessMapType: MapTypeKey = "map";
	const guessPrefs: MapEmbedPrefs = {
		...prefs,
		mapType: guessMapType,
		svPanoramas: false,
		svOpacity: 0,
	};
	const [isActive, setIsActive] = useState(false);
	const [zoom, setZoom] = useState(1.5);
	const deactivateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mapEngagedRef = useRef(false);
	const pointerInsideRef = useRef(false);
	const lastPointerRef = useRef({ x: 0, y: 0 });

	const clearDeactivateTimer = useCallback(() => {
		if (deactivateTimerRef.current) {
			clearTimeout(deactivateTimerRef.current);
			deactivateTimerRef.current = null;
		}
	}, []);

	const activatePanel = useCallback(() => {
		clearDeactivateTimer();
		setIsActive(true);
	}, [clearDeactivateTimer]);

	const scheduleDeactivatePanel = useCallback(() => {
		if (sticky || mapEngagedRef.current || pointerInsideRef.current) return;
		clearDeactivateTimer();
		deactivateTimerRef.current = setTimeout(() => {
			if (pointerInsideRef.current || sticky || mapEngagedRef.current) return;
			setIsActive(false);
		}, ACTIVE_LEAVE_DELAY_MS);
	}, [sticky, clearDeactivateTimer]);

	const syncHoverFromPoint = useCallback(
		(x: number, y: number) => {
			lastPointerRef.current = { x, y };
			const inside = pointInGuessMapPanel(rootRef.current, x, y);
			const wasInside = pointerInsideRef.current;
			pointerInsideRef.current = inside;
			if (inside) {
				activatePanel();
			} else if (wasInside) {
				scheduleDeactivatePanel();
			}
		},
		[activatePanel, scheduleDeactivatePanel],
	);

	useEffect(() => {
		const onPointerMove = (e: PointerEvent) => {
			lastPointerRef.current = { x: e.clientX, y: e.clientY };
			// While dragging (pano pan, etc.) don't expand — wait for pointerup.
			if (e.buttons !== 0) return;
			syncHoverFromPoint(e.clientX, e.clientY);
		};
		const onPointerUp = (e: PointerEvent) => {
			mapEngagedRef.current = false;
			// After pano drag, mouseenter often never fires — hit-test on release.
			syncHoverFromPoint(e.clientX, e.clientY);
		};
		window.addEventListener("pointermove", onPointerMove, { passive: true });
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerUp);
		return () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerUp);
		};
	}, [syncHoverFromPoint]);

	useEffect(() => () => clearDeactivateTimer(), [clearDeactivateTimer]);

	useEffect(() => {
		if (sticky) activatePanel();
	}, [sticky, activatePanel]);

	// Re-hit-test after size layout transitions (cursor may already be over the panel).
	useEffect(() => {
		const { x, y } = lastPointerRef.current;
		if (!x && !y) return;
		const id = window.setTimeout(() => syncHoverFromPoint(x, y), 280);
		return () => clearTimeout(id);
	}, [mapSize, syncHoverFromPoint]);

	const { hostRef, overlayRef, ready } = useGuessMapHost(
		containerRef,
		guessPrefs,
		locked,
		showResult,
		roundKey,
		onGuess,
		setZoom,
	);

	// Debounce map resize so MapLibre doesn't blank its WebGL canvas during CSS
	// width/height transitions (active↔inactive, size changes).  The longest
	// transition is ~370 ms (0.25s + 0.12s delay); a 420 ms debounce ensures
	// resize fires exactly once *after* the container has settled.
	useEffect(() => {
		if (!ready) return;
		const el = containerRef.current;
		if (!el) return;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const scheduleResize = () => {
			if (timer != null) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				hostRef.current?.resize();
			}, 420);
		};
		const ro = new ResizeObserver(() => scheduleResize());
		ro.observe(el);
		scheduleResize();
		return () => {
			ro.disconnect();
			if (timer != null) clearTimeout(timer);
		};
	}, [ready, mapSize, isActive]);

	const cycleBasemap = useCallback(() => {}, []);

	const nextBasemapLabel = t(
		MAP_TYPE_LABEL_KEYS[
			GUESS_MAP_TYPES[(GUESS_MAP_TYPES.indexOf(guessMapType) + 1) % GUESS_MAP_TYPES.length]
		],
	);

	const mapActive = variant === "result" || sticky || isActive;

	// Deck layers: play keeps a guess pin; result layers + truth-pin click live in ResultOverlay.
	useEffect(() => {
		const overlay = overlayRef.current;
		if (!overlay || !ready) return;

		if (showResult && truth) {
			applyRoundResultOverlay(overlay, hostRef.current, {
				guess,
				truth,
				idleCursor: null,
			});
			return;
		}

		const layers = [];
		if (guess) {
			const pin = createGuessPinLayer("gg-guess-pin", guess);
			if (pin) layers.push(pin);
		}
		overlay.setProps({
			layers,
			onClick: undefined,
			onHover: undefined,
		});
		hostRef.current?.setCursor(locked ? null : "crosshair");
	}, [guess, truth, showResult, ready, overlayRef, hostRef, locked]);

	// Camera fit for the result view — separate so fitBounds doesn't thrash layers.
	useEffect(() => {
		const host = hostRef.current;
		if (!host || !ready || !showResult || !truth) return;

		// Defer until the container has been laid out after expanding to result size.
		const raf = requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				fitRoundResultCamera(host, guess, truth);
			});
		});
		return () => cancelAnimationFrame(raf);
	}, [showResult, truth, guess, ready, hostRef]);

	useEffect(() => {
		if (!ready) return;
		const id = requestAnimationFrame(() => hostRef.current?.resize());
		return () => cancelAnimationFrame(id);
	}, [mapSize, ready, hostRef, showResult]);

	const zoomIn = useCallback(() => {
		const host = hostRef.current;
		if (!host) return;
		const next = Math.round(host.getZoom()) + 1;
		host.setZoom(next);
		setZoom(next);
		// Keep deck overlay in sync after camera settle without recreating pin icons mid-zoom.
		requestAnimationFrame(() => host.resize());
	}, [hostRef]);

	const bumpSize = useCallback(
		(delta: number) => {
			const next = mapSize + delta;
			if (next < MIN_SIZE || next > MAX_SIZE) return;
			onSizeChange(next);
		},
		[mapSize, onSizeChange],
	);

	const zoomOut = useCallback(() => {
		const host = hostRef.current;
		if (!host) return;
		const next = Math.max(MIN_ZOOM, Math.round(host.getZoom()) - 1);
		host.setZoom(next);
		setZoom(next);
		requestAnimationFrame(() => host.resize());
	}, [hostRef]);

	const guessDisabled = !hasGuess || submitting;
	const guessLabel = submitting
		? t("Scoring…")
		: hasGuess
			? t("Guess")
			: t("Place your pin on the map");

	// Keep a stable canvas DOM node across play↔result so the MapHost / DeckGL
	// WebGL contexts are not destroyed every phase change.
	return (
		<div className={`gg-game-guess-map${showResult ? " gg-game-guess-map--result" : ""}`}>
			<div
				ref={rootRef}
				className={`gg-guess-map__root gg-guess-map--size-${mapSize}${mapActive || showResult ? " is-active" : ""}`}
				data-qa="guess-map"
				onPointerEnter={(e) => {
					if (showResult) return;
					syncHoverFromPoint(e.clientX, e.clientY);
				}}
				onPointerLeave={() => {
					if (showResult) return;
					const { x, y } = lastPointerRef.current;
					if (pointInGuessMapPanel(rootRef.current, x, y)) return;
					pointerInsideRef.current = false;
					scheduleDeactivatePanel();
				}}
				onFocusCapture={() => {
					if (!showResult) activatePanel();
				}}
				onBlurCapture={(e) => {
					if (showResult) return;
					if (!rootRef.current?.contains(e.relatedTarget as Node)) {
						scheduleDeactivatePanel();
					}
				}}
			>
				{!showResult && (
					<div
						className="gg-guess-map__controls"
						onPointerEnter={(e) => syncHoverFromPoint(e.clientX, e.clientY)}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={(e) => e.stopPropagation()}
					>
						<button
							type="button"
							className="gg-guess-map__control gg-guess-map__control--increase"
							disabled={mapSize >= MAX_SIZE}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={(e) => {
								e.stopPropagation();
								bumpSize(1);
							}}
							data-qa="guess-map__control--increase-size"
							aria-label={t("Increase size")}
						>
							<Icon path={mdiArrowTopLeft} />
						</button>
						<button
							type="button"
							className="gg-guess-map__control gg-guess-map__control--decrease"
							disabled={mapSize <= MIN_SIZE}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={(e) => {
								e.stopPropagation();
								bumpSize(-1);
							}}
							data-qa="guess-map__control--decrease-size"
							aria-label={t("Decrease size")}
						>
							<Icon path={mdiArrowBottomRight} />
						</button>
						<button
							type="button"
							className={`gg-guess-map__control gg-guess-map__control--sticky${sticky ? " is-active" : ""}`}
							onClick={(e) => {
								e.stopPropagation();
								onToggleSticky();
							}}
							data-qa={sticky ? "guess-map__control--sticky-active" : "guess-map__control--sticky"}
							aria-label={t("Sticky map")}
						>
							<Icon path={mdiPin} />
						</button>
						<button
							type="button"
							className="gg-guess-map__control gg-guess-map__control--basemap"
							onPointerDown={(e) => e.stopPropagation()}
							onClick={(e) => {
								e.stopPropagation();
								cycleBasemap();
							}}
							data-qa="guess-map__control--basemap"
							title={nextBasemapLabel}
							aria-label={t("Switch guess map basemap")}
						>
							<Icon path={mdiLayers} />
						</button>
					</div>
				)}

				<div
					className={`gg-guess-map__canvas-wrap${mapActive || showResult ? " gg-guess-map__canvas-wrap--active-bar" : ""}${showResult ? " gg-guess-map__canvas-wrap--result" : ""}`}
					onPointerDown={(e) => {
						if (showResult || e.button !== 0) return;
						mapEngagedRef.current = true;
						activatePanel();
					}}
				>
					{!showResult && (
						<div className="gg-guess-map__zoom">
							<button
								type="button"
								className="gg-guess-map__zoom-btn"
								onClick={zoomIn}
								aria-label={t("Zoom in")}
							>
								<Icon path={mdiPlus} />
							</button>
							<button
								type="button"
								className={`gg-guess-map__zoom-btn${zoom <= MIN_ZOOM ? " gg-guess-map__zoom-btn--disabled" : ""}`}
								onClick={zoomOut}
								disabled={zoom <= MIN_ZOOM}
								aria-label={t("Zoom out")}
							>
								<Icon path={mdiMinus} />
							</button>
						</div>
					)}
					<div ref={containerRef} className="gg-guess-map__canvas" data-qa="guess-map-canvas" />
				</div>

				{!showResult && (
					<div
						className="gg-guess-map__guess-btn-wrap"
						onPointerEnter={(e) => syncHoverFromPoint(e.clientX, e.clientY)}
					>
						<button
							type="button"
							className={`gg-guess-map__guess-btn${guessDisabled ? " gg-guess-map__guess-btn--disabled" : ""}`}
							disabled={guessDisabled}
							onClick={onSubmit}
							data-qa="perform-guess"
						>
							<span className="gg-guess-map__guess-btn-label">{guessLabel}</span>
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
