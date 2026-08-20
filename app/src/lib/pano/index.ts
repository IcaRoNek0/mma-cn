import { BaiduPanoramaProvider } from "./baidu";
import { TencentPanoramaProvider } from "./tencent";
import type { PanoramaProvider, PanoSource } from "./types";

export * from "./types";
export * from "./coords";
export * from "./orientation";
export { BaiduPanoramaProvider } from "./baidu";
export { TencentPanoramaProvider, tencentTileLevels } from "./tencent";

const providers: Record<PanoSource, PanoramaProvider> = {
	baidu_pano: new BaiduPanoramaProvider(),
	qq_pano: new TencentPanoramaProvider("qq_pano"),
	qq_trekker: new TencentPanoramaProvider("qq_trekker"),
};

export function getPanoramaProvider(source: PanoSource): PanoramaProvider {
	return providers[source];
}

export function isPanoSource(value: unknown): value is PanoSource {
	return value === "baidu_pano" || value === "qq_pano" || value === "qq_trekker";
}
