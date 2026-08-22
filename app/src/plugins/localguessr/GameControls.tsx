import type { PsvPanoramaController } from "@/lib/sv/panoSingleton";
import type { GamePanoHandle } from "./GamePanoView";

/** Movement controls are intentionally hidden until PSV navigation is implemented. */
export function GameControls(_props: {
	panorama: PsvPanoramaController | null;
	panoRef: React.RefObject<GamePanoHandle | null>;
	hideCar?: boolean;
	onToggleHideCar?: () => void;
}) {
	return null;
}
