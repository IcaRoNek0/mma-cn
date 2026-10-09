import { loadOpenSV } from "@/lib/sv/opensv";
import { isPanoSource } from "@/lib/pano";
import { useEffect } from "react";
import { useMapState } from "@/store/useMapStore";
import { getSettings } from "@/store/settings";
import { isPanoFallback } from "@/lib/sv/lookup";
import { sendHideCar } from "./PanoControls";
import { resetTrail, pushTrail, clearTrail } from "@/lib/sv/svTrail";
import { usePano } from "@/lib/hooks/usePano";
import { applyViewportLock } from "@/lib/sv/viewportLock";
import { usePanoViewer } from "./PanoViewerContext";
import { t } from "@/lib/i18n";

/** The pano session for the open location: resolve and show its pano, feed viewer walks
 *  into the draft and the trail. */
export function usePanoSession() {
	const location = useMapState((s) => s.activeLocation);
	const { edit, open } = usePanoViewer();
	const pano = usePano();

	useEffect(() => {
		if (!location) return;
		let cancelled = false;

		const offStatus = pano.on("status_changed", () => {
			if (cancelled || !pano.isLoaded()) return;
			const panoId = pano.panoId();
			const position = pano.position();
			if (!panoId || !position) return;
			const source = pano.psv()?.getMetadata()?.source;
			edit({ panoId, ...position, ...(source ? { extra: { ...location.extra, source } } : {}) });
			pushTrail(position.lng, position.lat);
		});
		const offLock = pano.on("pano_changed", () => void applyViewportLock(pano));

		void (isPanoSource(location.extra?.source) ? Promise.resolve() : loadOpenSV())
			.then(async () => {
				if (cancelled) return;
				sendHideCar(!getSettings().showCar);
				resetTrail(location.lng, location.lat);

				const shown = await pano.show(location);
				if (cancelled || shown.status === "superseded") return;
				if (isPanoFallback(location, shown.pano)) {
					pano.toast(t("Configured pano ID could not be found. Falling back to lat/lng."), 3000);
				}
				// From the resolve result directly: setPano() with the same id fires no status_changed.
				open(location, shown.pano?.id ?? null);
			})
			.catch((error: unknown) => {
				if (!cancelled) pano.toast(String(error), 5000);
			});

		return () => {
			cancelled = true;
			clearTrail();
			offStatus();
			offLock();
		};
	}, [pano, location?.id]);
}
