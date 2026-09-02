import type { GcjPoint, PanoramaLink } from "./types";

export type PanoMoveDirection = "forward" | "backward";

export const PANO_MOVE_MAX_DISTANCE_METERS = 50;
export const PANO_MOVE_MAX_ANGLE_DEGREES = 60;

export function angularDistance(a: number, b: number): number {
	return Math.abs(((a - b + 540) % 360) - 180);
}

export function distanceMeters(a: GcjPoint, b: GcjPoint): number {
	const latScale = 111_320;
	const meanLat = ((a.lat + b.lat) * Math.PI) / 360;
	const dx = (b.lng - a.lng) * latScale * Math.cos(meanLat);
	const dy = (b.lat - a.lat) * latScale;
	return Math.hypot(dx, dy);
}

export function selectMoveLink(
	links: PanoramaLink[],
	position: GcjPoint,
	heading: number,
	direction: PanoMoveDirection,
	previousPanoId?: string,
): PanoramaLink | null {
	const targetHeading = direction === "forward" ? heading : heading + 180;
	const candidates = links.flatMap((link) => {
		if (link.adjacent === false || !Number.isFinite(link.heading)) return [];
		const angle = angularDistance(link.heading!, targetHeading);
		const distance =
			link.distanceMeters ?? (link.position ? distanceMeters(position, link.position) : undefined);
		if (angle > PANO_MOVE_MAX_ANGLE_DEGREES) return [];
		if (distance != null && distance > PANO_MOVE_MAX_DISTANCE_METERS) return [];
		return [{ link, angle, distance: distance ?? Number.POSITIVE_INFINITY }];
	});

	if (direction === "backward" && previousPanoId) {
		const previous = candidates.find(({ link }) => link.panoId === previousPanoId);
		if (previous) return previous.link;
	}

	candidates.sort((a, b) => a.distance - b.distance || a.angle - b.angle);
	return candidates[0]?.link ?? null;
}

export const PANO_MARKER_MAX_DISTANCE_METERS = 100;
export const PANO_MARKER_HEADING_SEPARATION_DEGREES = 12;
export const PANO_MARKER_PITCH_RADIANS = -Math.PI / 6;

export interface PanoMoveCandidate {
	link: PanoramaLink;
	distance: number;
	pitch: number;
	visible: boolean;
}

export function movementCandidates(links: PanoramaLink[], position: GcjPoint): PanoMoveCandidate[] {
	const nearby = links
		.flatMap((link) => {
			if (!Number.isFinite(link.heading)) return [];
			const distance =
				link.distanceMeters ?? (link.position ? distanceMeters(position, link.position) : 15);
			if (distance <= 0 || distance > PANO_MARKER_MAX_DISTANCE_METERS) return [];
			return [
				{
					link,
					distance,
					pitch: PANO_MARKER_PITCH_RADIANS,
					visible: link.adjacent !== false,
				},
			];
		})
		.sort((a, b) => Number(b.visible) - Number(a.visible) || a.distance - b.distance);

	const result: PanoMoveCandidate[] = [];
	for (const candidate of nearby) {
		if (
			result.some(
				(existing) =>
					angularDistance(existing.link.heading!, candidate.link.heading!) <
					PANO_MARKER_HEADING_SEPARATION_DEGREES,
			)
		)
			continue;
		result.push(candidate);
	}
	return result;
}
