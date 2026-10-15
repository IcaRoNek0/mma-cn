import { useEffect, useRef } from "react";
import type { PsvPanoramaController } from "@/lib/sv/panoSingleton";

export function PsvCompass({
	panorama,
	className = "compass",
}: {
	panorama: PsvPanoramaController;
	className?: string;
}) {
	const compassRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const update = () =>
			compassRef.current?.style.setProperty("--heading", `${-panorama.getPov().heading}deg`);
		const listener = panorama.addListener("pov_changed", update);
		update();
		return () => listener.remove();
	}, [panorama]);
	return (
		<div ref={compassRef} className={className} aria-hidden="true">
			<svg className="compass__arrow" viewBox="0 0 40 100">
				<path fill="#C1272D" d="M10 50l10-32 10 32z" />
				<path fill="#D1D1D1" d="M30 50L20 82 10 50z" />
			</svg>
		</div>
	);
}
