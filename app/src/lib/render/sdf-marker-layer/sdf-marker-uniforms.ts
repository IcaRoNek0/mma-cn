import type { ShaderModule } from "@luma.gl/shadertools";

const glslUniformBlock = `\
layout(std140) uniform sdfMarkerUniforms {
  float radiusPixels;
  float strokeWidthPixels;
  highp int shapeType;
  float flattenOpacity;
} sdfMarker;
`;

export type SDFMarkerProps = {
	radiusPixels: number;
	strokeWidthPixels: number;
	shapeType: number;
	// > 0 enables layer-level translucency: output premultiplied color scaled by
	// this value, alpha left at full shape coverage (see markerLayer.ts blending).
	flattenOpacity: number;
};

export const sdfMarkerUniforms = {
	name: "sdfMarker",
	vs: glslUniformBlock,
	fs: glslUniformBlock,
	source: "",
	uniformTypes: {
		radiusPixels: "f32",
		strokeWidthPixels: "f32",
		shapeType: "i32",
		flattenOpacity: "f32",
	},
} as const satisfies ShaderModule<SDFMarkerProps>;
