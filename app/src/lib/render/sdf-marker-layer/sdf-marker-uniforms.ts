import type { ShaderModule } from "@luma.gl/shadertools";

const glslUniformBlock = `\
layout(std140) uniform sdfMarkerUniforms {
  float radiusPixels;
  float strokeWidthPixels;
  highp int shapeType;
} sdfMarker;
`;

export type SDFMarkerProps = {
	radiusPixels: number;
	strokeWidthPixels: number;
	shapeType: number;
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
	},
} as const satisfies ShaderModule<SDFMarkerProps>;
