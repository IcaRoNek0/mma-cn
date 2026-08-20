import type { PanoSource } from "./types";

const FULL_TURN = 360;
const HALF_TURN = 180;

export function normalizeAbsoluteHeading(heading: number): number {
	return ((heading % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

function normalizeRelativeHeading(heading: number): number {
	return ((((heading + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN) - HALF_TURN;
}

/** Baidu yaw zero is NorthDir counterclockwise from north; Tencent follows basic.dir. */
export function panoramaYawOrigin(
	source: PanoSource,
	metadataHeading: number,
	northOffset: number,
): number {
	return normalizeAbsoluteHeading(source === "baidu_pano" ? 180 - northOffset : metadataHeading);
}

/** Convert PSV's image-relative yaw to an absolute compass heading. */
export function viewerYawToHeading(yaw: number, panoramaHeading: number): number {
	return normalizeAbsoluteHeading(panoramaHeading + (yaw * HALF_TURN) / Math.PI);
}

/** Convert an absolute compass heading to PSV's shortest image-relative yaw. */
export function headingToViewerYaw(heading: number, panoramaHeading: number): number {
	return (normalizeRelativeHeading(heading - panoramaHeading) * Math.PI) / HALF_TURN;
}
