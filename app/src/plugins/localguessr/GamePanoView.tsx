import {
	useLayoutEffect,
	useRef,
	useState,
	useCallback,
	useImperativeHandle,
	forwardRef,
} from "react";
import type { Location } from "@/bindings.gen";
import { createLocation } from "@/types";
import {
	applyLocationPanorama,
	getPanorama,
	singletonDiv,
	type PsvPanoramaController,
} from "@/lib/sv/panoSingleton";
import { t } from "@/lib/i18n";
import { getPanoramaProvider } from "@/lib/pano";
import type { MovementMode, RoundLocation } from "./GameState";

function toLocation(r: RoundLocation): Location {
	return createLocation({
		id: r.id,
		lat: r.lat,
		lng: r.lng,
		heading: r.heading,
		pitch: r.pitch,
		zoom: r.zoom,
		panoId: r.panoId,
		extra: {
			source:
				r.provider === "tencent" || r.provider === "qq_pano" || r.provider === "qq_trekker"
					? "qq_pano"
					: "baidu_pano",
		},
	});
}

export interface GamePanoHandle {
	returnToSpawn: () => void;
	setCheckpoint: () => void;
	returnToCheckpoint: () => void;
	hasCheckpoint: () => boolean;
	undoMove: () => void;
	canUndoMove: () => boolean;
	getPanorama: () => PsvPanoramaController | null;
	supportsHideCar: () => boolean;
}

export const GamePanoView = forwardRef<
	GamePanoHandle,
	{
		round: RoundLocation;
		movementMode: MovementMode;
		onReady?: (ready: boolean) => void;
		onPanorama?: (pano: PsvPanoramaController | null) => void;
		onCanUndoChange?: (canUndo: boolean) => void;
	}
>(function GamePanoView({ round, onReady, onPanorama, onCanUndoChange }, ref) {
	const hostRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);
	const spawnRef = useRef(round);

	const restoreSpawn = useCallback(() => {
		const pano = getPanorama();
		if (!pano) return;
		void applyLocationPanorama(toLocation(spawnRef.current));
	}, []);

	useImperativeHandle(
		ref,
		() => ({
			returnToSpawn: restoreSpawn,
			setCheckpoint: () => {},
			returnToCheckpoint: () => {},
			hasCheckpoint: () => false,
			undoMove: () => {},
			canUndoMove: () => false,
			getPanorama,
			supportsHideCar: () => false,
		}),
		[restoreSpawn],
	);

	useLayoutEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		let cancelled = false;
		spawnRef.current = round;
		onReady?.(false);
		onCanUndoChange?.(false);
		setError(null);
		if (!host.contains(singletonDiv)) host.appendChild(singletonDiv);
		void (async () => {
			const loc = toLocation(round);
			if (!loc.panoId) {
				const source = loc.extra?.source === "qq_pano" ? "qq_pano" : "baidu_pano";
				const hit = await getPanoramaProvider(source).findNearest(
					{ lat: loc.lat, lng: loc.lng },
					loc.zoom,
				);
				if (!hit) throw new Error(t("No panorama found"));
				loc.panoId = hit.panoId;
				loc.heading = hit.heading;
			}
			await applyLocationPanorama(loc);
		})()
			.then(() => {
				if (cancelled) return;
				onPanorama?.(getPanorama());
				onReady?.(true);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : t("Failed to load panorama"));
				onReady?.(false);
			});
		return () => {
			cancelled = true;
			onPanorama?.(null);
			onReady?.(false);
			if (host.contains(singletonDiv)) host.removeChild(singletonDiv);
		};
	}, [round.id, onReady, onPanorama, onCanUndoChange]);

	return (
		<div className="gg-pano">
			<div ref={hostRef} className="gg-pano__host" />
			{error && <div className="gg-pano__error">{error}</div>}
		</div>
	);
});
