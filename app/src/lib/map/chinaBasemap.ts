import type { StyleSpecification } from "maplibre-gl";
import type { MapEmbedPrefs } from "@/store/mapEmbedPrefs";

export const BAIDU_COVERAGE_SOURCE = "mma-cn-coverage-baidu";
export const COVERAGE_LAYER_PREFIX = "mma-cn-coverage";

const CHINA_BOUNDS: [number, number, number, number] = [72.004, 0.8293, 137.8347, 55.8271];
export function activeChinaPanoProvider(value: unknown): "baidu" | "tencent" {
	return value === "tencent" ? "tencent" : "baidu";
}

export function activeCoverageOpacity(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(1, Math.max(0, value))
		: 0.5;
}

export function activeCoverageProviders(
	providerValue: unknown,
	opacityValue: unknown,
): { baidu: boolean; tencent: boolean } {
	const provider = activeChinaPanoProvider(providerValue);
	const visible = activeCoverageOpacity(opacityValue) > 0;
	return {
		baidu: visible && provider === "baidu",
		tencent: visible && provider === "tencent",
	};
}

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

export function chinaBasemapStyle(prefs: MapEmbedPrefs): StyleSpecification {
	const opacity = activeCoverageOpacity(prefs.svOpacity);
	const active = activeCoverageProviders(prefs.panoProvider, prefs.svVisible ? prefs.svOpacity : 0);
	return {
		version: 8,
		sources: {
			petal: {
				type: "raster",
				tiles: [petalTileUrl()],
				tileSize: 256,
				maxzoom: 19,
				attribution: "Huawei Petal Maps",
			},
			[BAIDU_COVERAGE_SOURCE]: {
				type: "raster",
				tiles: ["mma-baidu://tiles/{z}/{x}/{y}"],
				tileSize: 256,
				minzoom: 3,
				maxzoom: 20,
				bounds: CHINA_BOUNDS,
			},
		},
		layers: [
			{ id: "petal-background", type: "background", paint: { "background-color": "#e8e4dc" } },
			{ id: "petal", type: "raster", source: "petal", paint: { "raster-fade-duration": 0 } },
			{
				id: `${COVERAGE_LAYER_PREFIX}-baidu`,
				type: "raster",
				source: BAIDU_COVERAGE_SOURCE,
				minzoom: 2,
				layout: { visibility: active.baidu ? "visible" : "none" },
				paint: {
					"raster-opacity": opacity,
					"raster-hue-rotate": 140,
					"raster-saturation": 1,
					"raster-resampling": "nearest",
					"raster-fade-duration": 0,
				},
			},
		],
	};
}
