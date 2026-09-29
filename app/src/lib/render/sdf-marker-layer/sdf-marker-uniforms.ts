import type { ShaderModule } from "@luma.gl/shadertools";

const glslUniformBlock = `\
layout(std140) uniform sdfMarkerUniforms {
  float radiusPixels;
  highp int shapeType;
} sdfMarker;
`;

export type SDFMarkerProps = {
	radiusPixels: number;
	shapeType: number;
};

export const sdfMarkerUniforms = {
	name: "sdfMarker",
	vs: glslUniformBlock,
	fs: glslUniformBlock,
	source: "",
	uniformTypes: {
		radiusPixels: "f32",
		shapeType: "i32",
	},
} as const satisfies ShaderModule<SDFMarkerProps>;
