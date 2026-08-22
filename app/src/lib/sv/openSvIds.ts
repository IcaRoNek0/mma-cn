import type { PanoSource } from "@/lib/pano";

export const BAIDU_VIEWER_PREFIX = "BAIDU:";
export const TENCENT_VIEWER_PREFIX = "TENCENT:";

export function viewerPanoId(source: PanoSource, panoId: string): string {
	const raw = stripViewerPanoId(panoId);
	return source === "baidu_pano"
		? `${BAIDU_VIEWER_PREFIX}${raw}`
		: `${TENCENT_VIEWER_PREFIX}${raw}`;
}

export function sourceForViewerPanoId(panoId: string): PanoSource | null {
	if (panoId.startsWith(BAIDU_VIEWER_PREFIX)) return "baidu_pano";
	if (panoId.startsWith(TENCENT_VIEWER_PREFIX)) return "qq_pano";
	return null;
}

export function stripViewerPanoId(panoId: string): string {
	if (panoId.startsWith(BAIDU_VIEWER_PREFIX)) return panoId.slice(BAIDU_VIEWER_PREFIX.length);
	if (panoId.startsWith(TENCENT_VIEWER_PREFIX)) return panoId.slice(TENCENT_VIEWER_PREFIX.length);
	return panoId;
}
