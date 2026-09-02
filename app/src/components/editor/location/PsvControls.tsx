import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
	mdiChevronUp,
	mdiFullscreen,
	mdiFullscreenExit,
	mdiHome,
	mdiLoading,
	mdiMinus,
	mdiPlus,
} from "@mdi/js";
import { Icon } from "@/components/primitives/Icon";
import { Tooltip } from "@/components/primitives/Tooltip";
import { useSettings } from "@/store/settings";
import type { PsvMoveMarker, PsvPanoramaController } from "@/lib/sv/panoSingleton";
import { toast } from "@/lib/util/toast";
import { t } from "@/lib/i18n";

export const PsvMoveControls = memo(function PsvMoveControls({
	panorama,
}: {
	panorama: PsvPanoramaController;
}) {
	const [markers, setMarkers] = useState<PsvMoveMarker[]>(() => panorama.getMoveMarkers());
	const [loading, setLoading] = useState(() => panorama.isNavigationLoading());

	useEffect(() => {
		let frame = 0;
		const update = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				setLoading(panorama.isNavigationLoading());
				setMarkers(panorama.getMoveMarkers());
			});
		};
		const listeners = [
			panorama.addListener("pov_changed", update),
			panorama.addListener("zoom_changed", update),
			panorama.addListener("links_changed", update),
			panorama.addListener("navigation_changed", update),
			panorama.addListener("size_changed", update),
		];
		update();
		return () => {
			if (frame) cancelAnimationFrame(frame);
			listeners.forEach((listener) => listener.remove());
		};
	}, [panorama]);

	const moveTo = useCallback(
		(panoId: string) => {
			void panorama.moveTo(panoId).catch((error: unknown) => {
				toast(error instanceof Error ? error.message : t("Panorama failed to load"), 4000);
			});
		},
		[panorama],
	);

	return (
		<div className={`psv-move-markers${loading ? " is-loading" : ""}`} aria-live="polite">
			{markers.map((marker) => (
				<button
					key={marker.panoId}
					type="button"
					className={`psv-move-marker${marker.visible ? "" : " is-hidden"}`}
					disabled={loading}
					tabIndex={marker.visible ? 0 : -1}
					aria-hidden={!marker.visible}
					onClick={() => moveTo(marker.panoId)}
					aria-label={`${t("Move forward")} ${Math.round(marker.distance)}m`}
					style={
						{
							left: marker.x,
							top: marker.y,
							"--marker-scale": marker.scale,
						} as CSSProperties
					}
				>
					<Icon
						path={loading ? mdiLoading : mdiChevronUp}
						className={loading ? "spin" : undefined}
					/>
				</button>
			))}
		</div>
	);
});

export const PsvControls = memo(function PsvControls({
	panorama,
	isFullscreen,
	onFullscreen,
	onReturnToSpawn,
}: {
	panorama: PsvPanoramaController;
	isFullscreen: boolean;
	onFullscreen: () => void;
	onReturnToSpawn: () => void;
}) {
	const settings = useSettings();
	const compassRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const update = () =>
			compassRef.current?.style.setProperty("--heading", `${-panorama.getPov().heading}deg`);
		const listener = panorama.addListener("pov_changed", update);
		update();
		return () => listener.remove();
	}, [panorama]);

	return (
		<div className="embed-controls">
			{settings.defaultMovementMode === "moving" && <PsvMoveControls panorama={panorama} />}
			{settings.showFullscreenButton && (
				<div className="embed-controls__control" style={{ inset: "0 0 auto auto" }}>
					<div className="map-control map-control--button">
						<Tooltip content={t("Toggle fullscreen")} side="bottom">
							<button onClick={onFullscreen} aria-label={t("Toggle fullscreen")}>
								<Icon path={isFullscreen ? mdiFullscreenExit : mdiFullscreen} />
							</button>
						</Tooltip>
					</div>
				</div>
			)}
			{settings.showCompass && (
				<div ref={compassRef} className="compass">
					<svg className="compass__arrow" viewBox="0 0 40 100">
						<path fill="#C1272D" d="M10 50l10-32 10 32z" />
						<path fill="#D1D1D1" d="M30 50L20 82 10 50z" />
					</svg>
				</div>
			)}
			{settings.showZoom && (
				<div className="embed-controls__control" style={{ inset: "auto 0 0 auto" }}>
					<div className="map-control map-control--button">
						<button
							onClick={() => panorama.setZoom(panorama.getZoom() + 1)}
							aria-label={t("Zoom in")}
						>
							<Icon path={mdiPlus} />
						</button>
						<button
							onClick={() => panorama.setZoom(panorama.getZoom() - 1)}
							aria-label={t("Zoom out")}
						>
							<Icon path={mdiMinus} />
						</button>
					</div>
				</div>
			)}
			{settings.showReturnToSpawn && (
				<div className="embed-controls__control" style={{ inset: "auto auto 0 0" }}>
					<div className="map-control map-control--button">
						<Tooltip content={t("Return to start")} side="top">
							<button onClick={onReturnToSpawn} aria-label={t("Return to start")}>
								<Icon path={mdiHome} />
							</button>
						</Tooltip>
					</div>
				</div>
			)}
		</div>
	);
});
