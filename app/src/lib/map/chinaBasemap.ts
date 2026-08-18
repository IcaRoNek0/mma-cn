import type { StyleSpecification } from "maplibre-gl";

const PETAL_BASE =
	"https://maprastertile-drcn.dbankcdn.cn/display-service/v1/online-render/getTile/26.02.03.16/{z}/{x}/{y}/";
export function petalTileUrl(): string {
	const configured = import.meta.env.VITE_PETAL_TILE_URL?.trim();
	if (configured) return configured;
	const key = import.meta.env.VITE_PETAL_MAP_KEY?.trim() || "";
	const query = new URLSearchParams({
		language: "zh",
		p: "46",
		scale: "2",
		mapType: "ROADMAP",
		presetStyleId: "standard",
		pattern: "JPG",
		key,
	});
	return `${PETAL_BASE}?${query}`;
}

export function chinaBasemapStyle(): StyleSpecification {
	return {
		version: 8,
		sources: {
			petal: {
				type: "raster",
				tiles: [petalTileUrl()],
				tileSize: 256,
				maxzoom: 20,
				attribution: "Huawei Petal Maps",
			},
		},
		layers: [
			{ id: "petal-background", type: "background", paint: { "background-color": "#e8e4dc" } },
			{ id: "petal", type: "raster", source: "petal", paint: { "raster-fade-duration": 0 } },
		],
	};
}

export const TENCENT_COVERAGE_URL =
	import.meta.env.VITE_TENCENT_COVERAGE_URL?.trim() || "https://qq-map.netlify.app/lines.pmtiles";
