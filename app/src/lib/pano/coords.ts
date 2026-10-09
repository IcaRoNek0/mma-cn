import gcoord from "gcoord";
import type { GcjPoint } from "./types";

type Coordinate = [number, number];

export function gcj02ToWgs84(point: GcjPoint): GcjPoint {
	const [lng, lat] = gcoord.transform(
		[point.lng, point.lat],
		gcoord.GCJ02,
		gcoord.WGS84,
	) as Coordinate;
	return { lng, lat };
}

export function wgs84ToGcj02(point: GcjPoint): GcjPoint {
	const [lng, lat] = gcoord.transform(
		[point.lng, point.lat],
		gcoord.WGS84,
		gcoord.GCJ02,
	) as Coordinate;
	return { lng, lat };
}

export function gcj02ToBd09Mc(point: GcjPoint): Coordinate {
	return gcoord.transform([point.lng, point.lat], gcoord.GCJ02, gcoord.BD09MC) as Coordinate;
}

export function bd09McToGcj02(x: number, y: number): GcjPoint {
	const [lng, lat] = gcoord.transform([x, y], gcoord.BD09MC, gcoord.GCJ02) as Coordinate;
	return { lng, lat };
}
