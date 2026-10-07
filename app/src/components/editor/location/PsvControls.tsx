import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
	mdiChevronUp,
	mdiFullscreen,
	mdiFullscreenExit,
	mdiHome,
	mdiLoading,
	mdiMinus,
	mdiPlus,
	mdiInformationOutline,
	mdiContentCopy,
	mdiClose,
} from "@mdi/js";
import * as Popover from "@radix-ui/react-popover";
import { Icon } from "@/components/primitives/Icon";
import { Tooltip } from "@/components/primitives/Tooltip";
import { useSettings } from "@/store/settings";
import type { PsvMoveMarker, PsvPanoramaController } from "@/lib/sv/panoSingleton";
import { toast } from "@/lib/util/toast";
import { t } from "@/lib/i18n";


function PsvMetadataControl({ panorama }: { panorama: PsvPanoramaController }) {
	const [metadata, setMetadata] = useState(() => panorama.getMetadata());
	useEffect(() => {
		const update = () => setMetadata(panorama.getMetadata());
		const listener = panorama.addListener("pano_changed", update);
		update();
		return () => listener.remove();
	}, [panorama]);
	const copy = async (value: string) => {
		try {
			await navigator.clipboard.writeText(value);
			toast(t("Copied"));
		} catch {
			toast(t("Copy failed"));
		}
	};
	const rows: readonly (readonly [string, string, boolean?])[] = metadata ? [
		["panoid", metadata.panoId, true],
		[t("Coordinates") + " (GCJ-02)", `${metadata.position.lat}, ${metadata.position.lng}`, true],
		[t("Source"), metadata.source],
		[t("Address"), metadata.address ?? "—"],
		[t("Altitude"), metadata.altitude == null ? "—" : `${metadata.altitude} m`],
		[t("Heading"), `${metadata.heading}°`],
		[t("Pitch"), `${metadata.pitch}°`],
		[t("North offset"), `${metadata.northOffset}°`],
	] as const : [];
	return (
		<div className="embed-controls__control" style={{ inset: "auto auto 56px 0" }}>
			<Popover.Root>
				<div className="map-control map-control--button">
					<Tooltip content={t("Street View metadata")} side="right">
						<Popover.Trigger asChild>
							<button aria-label={t("Street View metadata")}><Icon path={mdiInformationOutline} /></button>
						</Popover.Trigger>
					</Tooltip>
				</div>
				<Popover.Portal>
					<Popover.Content className="psv-metadata-panel" side="right" align="end" sideOffset={8} collisionPadding={12} aria-label={t("Street View metadata")}>
						<div className="psv-metadata-panel__header">
							<strong>{t("Street View metadata")}</strong>
							<Popover.Close aria-label={t("Close")}><Icon path={mdiClose} /></Popover.Close>
						</div>
						{metadata ? <>
							<dl>{rows.map(([label, value, canCopy]) => (
								<div key={label} className="psv-metadata-panel__row">
									<dt>{label}</dt>
									<dd className={canCopy ? "psv-metadata-panel__copy" : undefined}>
										<span>{value}</span>
										{canCopy && <button aria-label={label === "panoid" ? t("Copy panoid") : t("Copy coordinates")} onClick={() => void copy(value)}><Icon path={mdiContentCopy} /></button>}
									</dd>
								</div>
							))}</dl>
							<details><summary>{t("Full metadata")}</summary><pre>{JSON.stringify(metadata, null, 2)}</pre></details>
						</> : <p>{t("No panorama metadata available")}</p>}
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>
		</div>
	);
}

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
			<PsvMetadataControl panorama={panorama} />
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
