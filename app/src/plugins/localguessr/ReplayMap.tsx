import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import type { LatLng } from "@/types";
import { useT } from "@/lib/i18n";
import type { RoundResult } from "./GameState";
import { applyReplayResultOverlay } from "./resultMapOverlay";
import {
	createMapHost,
	hostKindForMapType,
	type MapHost,
	type DeckOverlayHandle,
} from "@/lib/map/host";
import { CUSTOM_STYLES_KEY, type CustomStyle } from "@/lib/geo/mapStack";
import { getLocal, useLocalStorage } from "@/lib/hooks/useLocalStorage";
import { type MapEmbedPrefs, DEFAULT_PREFS } from "@/store/mapEmbedPrefs";

function boundsForRounds(rounds: RoundResult[]): {
	south: number;
	west: number;
	north: number;
	east: number;
} | null {
	let south = Infinity;
	let north = -Infinity;
	let west = Infinity;
	let east = -Infinity;
	for (const r of rounds) {
		const { lat, lng } = r.location;
		south = Math.min(south, lat);
		north = Math.max(north, lat);
		west = Math.min(west, lng);
		east = Math.max(east, lng);
		if (r.guess) {
			south = Math.min(south, r.guess.lat);
			north = Math.max(north, r.guess.lat);
			west = Math.min(west, r.guess.lng);
			east = Math.max(east, r.guess.lng);
		}
	}
	if (!Number.isFinite(south)) return null;
	if (south === north) {
		south -= 0.01;
		north += 0.01;
	}
	if (west === east) {
		west -= 0.01;
		east += 0.01;
	}
	return { south, west, north, east };
}

function useReplayMapHost(
	containerRef: React.RefObject<HTMLDivElement | null>,
	guessPrefs: MapEmbedPrefs,
) {
	const hostRef = useRef<MapHost | null>(null);
	const overlayRef = useRef<DeckOverlayHandle | null>(null);
	const divRef = useRef<HTMLDivElement | null>(null);
	const [ready, setReady] = useState(false);

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let cancelled = false;

		void (async () => {
			const kind = hostKindForMapType(guessPrefs.mapType);
			const div = document.createElement("div");
			div.className = "gg-guess-map__host-mount";
			div.style.cssText = "position:absolute;inset:0";
			container.appendChild(div);
			divRef.current = div;

			try {
				const host = await createMapHost(kind, div, guessPrefs, {
					customStyles: getLocal<CustomStyle[]>(CUSTOM_STYLES_KEY, []),
					camera: { center: { lat: 20, lng: 0 }, zoom: 1.5 },
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
			} catch {
				if (!cancelled) setReady(false);
			}
		})();

		return () => {
			cancelled = true;
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
		guessPrefs.mapType,
		guessPrefs.mapStyleName,
		guessPrefs.vectorStyleName,
		guessPrefs.showTerrain,
		guessPrefs.showLabels,
	]);

	return { hostRef, overlayRef, ready };
}

export function ReplayMap({
	rounds,
	highlighted,
}: {
	rounds: RoundResult[];
	highlighted: number | null;
}) {
	const { t } = useT();
	const containerRef = useRef<HTMLDivElement>(null);
	const [prefs] = useLocalStorage<MapEmbedPrefs>("mapEmbedPrefs", DEFAULT_PREFS);
	const guessPrefs: MapEmbedPrefs = {
		...prefs,
		mapType: "map",
		svPanoramas: false,
		svOpacity: 0,
	};
	const { hostRef, overlayRef, ready } = useReplayMapHost(containerRef, guessPrefs);

	const fitAllRounds = useCallback(() => {
		const host = hostRef.current;
		if (!host) return;
		const bounds = boundsForRounds(rounds);
		if (!bounds) return;
		host.fitBounds(bounds, 72);
	}, [rounds, hostRef]);

	const fitToRound = useCallback(
		(index: number) => {
			const r = rounds[index];
			const host = hostRef.current;
			if (!host || !r) return;
			const guess = r.guess;
			const truth: LatLng = { lat: r.location.lat, lng: r.location.lng };

			if (guess) {
				host.fitBounds(
					{
						south: Math.min(guess.lat, truth.lat),
						west: Math.min(guess.lng, truth.lng),
						north: Math.max(guess.lat, truth.lat),
						east: Math.max(guess.lng, truth.lng),
					},
					80,
				);
			} else {
				host.moveCamera({ center: truth, zoom: 8 });
			}
		},
		[rounds, hostRef],
	);

	// Rebuild only when rounds/highlight change — never on zoom (GPU dashes stay dense).
	useEffect(() => {
		const overlay = overlayRef.current;
		if (!overlay || !ready) return;

		const visible =
			highlighted != null ? (rounds[highlighted] ? [rounds[highlighted]] : []) : rounds;

		applyReplayResultOverlay(overlay, hostRef.current, visible, {
			pinSize: highlighted != null ? 36 : 28,
		});
	}, [rounds, highlighted, ready, overlayRef, hostRef]);

	useEffect(() => {
		if (!ready) return;
		const raf = requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				if (highlighted != null) fitToRound(highlighted);
				else fitAllRounds();
			});
		});
		return () => cancelAnimationFrame(raf);
	}, [ready, highlighted, fitToRound, fitAllRounds]);

	useEffect(() => {
		if (!ready) return;
		const raf = requestAnimationFrame(() => hostRef.current?.resize());
		return () => cancelAnimationFrame(raf);
	}, [ready, hostRef]);

	if (rounds.length === 0) {
		return (
			<div className="gg-replay-map__empty">
				{t("No games played yet. Start a round to build analytics.")}
			</div>
		);
	}

	return (
		<div className="gg-replay-map">
			<div ref={containerRef} className="gg-replay-map__canvas" data-qa="replay-map-canvas" />
		</div>
	);
}
