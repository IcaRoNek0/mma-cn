import { describe, expect, it } from "vitest";
import {
	headingToViewerYaw,
	normalizeAbsoluteHeading,
	panoramaYawOrigin,
	viewerYawToHeading,
} from "@/lib/pano/orientation";

const radians = (degrees: number) => (degrees * Math.PI) / 180;

describe("provider panorama orientation", () => {
	it("rotates Baidu yaw zero counterclockwise by NorthDir and uses Tencent dir", () => {
		expect(panoramaYawOrigin("baidu_pano", 135, 15)).toBe(165);
		expect(panoramaYawOrigin("baidu_pano", 135, -30)).toBe(210);
		expect(panoramaYawOrigin("qq_pano", 90, 15)).toBe(90);
		expect(panoramaYawOrigin("qq_trekker", -30, 15)).toBe(330);
	});

	it("adds the provider heading to PSV's image-relative yaw", () => {
		expect(viewerYawToHeading(0, 135)).toBe(135);
		expect(viewerYawToHeading(radians(45), 135)).toBe(180);
		expect(viewerYawToHeading(radians(-135), 135)).toBe(0);
	});

	it("points PSV at the image-relative yaw for an absolute heading", () => {
		expect(headingToViewerYaw(0, 135)).toBeCloseTo(radians(-135));
		expect(headingToViewerYaw(180, 135)).toBeCloseTo(radians(45));
		expect(headingToViewerYaw(350, 20)).toBeCloseTo(radians(-30));
	});

	it("round-trips headings across the zero-degree seam", () => {
		for (const heading of [0, 1, 179, 180, 270, 359]) {
			const yaw = headingToViewerYaw(heading, 315);
			expect(viewerYawToHeading(yaw, 315)).toBeCloseTo(normalizeAbsoluteHeading(heading));
		}
	});
});
