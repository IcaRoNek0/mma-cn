import { memo, useEffect, useRef } from "react";
import { mdiFullscreen, mdiFullscreenExit, mdiHome, mdiMinus, mdiPlus } from "@mdi/js";
import { Icon } from "@/components/primitives/Icon";
import { Tooltip } from "@/components/primitives/Tooltip";
import { useSettings } from "@/store/settings";
import type { PsvPanoramaController } from "@/lib/sv/panoSingleton";
import { t } from "@/lib/i18n";

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
						<button onClick={() => panorama.setZoom(panorama.getZoom() + 1)} aria-label={t("Zoom in")}>
							<Icon path={mdiPlus} />
						</button>
						<button onClick={() => panorama.setZoom(panorama.getZoom() - 1)} aria-label={t("Zoom out")}>
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
