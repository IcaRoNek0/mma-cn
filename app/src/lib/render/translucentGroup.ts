import { Layer, type LayerContext } from "@deck.gl/core";
import type { Device, Framebuffer } from "@luma.gl/core";
import { ClipSpace } from "@luma.gl/engine";
import type { ShaderModule } from "@luma.gl/shadertools";
import type { WebGLDevice, WEBGLRenderPass } from "@luma.gl/webgl";

const groups = new WeakMap<Device, Map<string, Framebuffer>>();

function groupFramebuffer(device: Device, group: string): Framebuffer {
	let byGroup = groups.get(device);
	if (!byGroup) groups.set(device, (byGroup = new Map()));
	const { drawingBufferWidth: width, drawingBufferHeight: height } = (device as WebGLDevice).gl;
	let fbo = byGroup.get(group);
	if (fbo && (fbo.width !== width || fbo.height !== height)) {
		fbo.destroy();
		fbo = undefined;
	}
	if (!fbo) {
		fbo = device.createFramebuffer({ width, height, colorAttachments: ["rgba8unorm"] });
		byGroup.set(group, fbo);
	}
	return fbo;
}

/** Runs `draw` against the group's offscreen target instead of the screen, in the viewport
 *  the screen pass is using. */
export function drawIntoGroup(
	context: LayerContext,
	group: string,
	draw: (pass: LayerContext["renderPass"]) => void,
): void {
	const pass = context.device.beginRenderPass({
		framebuffer: groupFramebuffer(context.device, group),
		parameters: {
			viewport: (context.renderPass as WEBGLRenderPass).glParameters.viewport as [
				number,
				number,
				number,
				number,
			],
		},
		clearColor: false,
		clearDepth: false,
		clearStencil: false,
	});
	draw(pass);
	pass.end();
}

type GroupProps = { opacity: number };

const groupUniforms = {
	name: "translucentGroup",
	fs: `\
layout(std140) uniform translucentGroupUniforms {
  float opacity;
} translucentGroup;
`,
	uniformTypes: { opacity: "f32" },
} as const satisfies ShaderModule<GroupProps>;

const compositeFs = `\
#version 300 es
precision highp float;
uniform sampler2D groupTexture;
out vec4 fragColor;
void main() {
  fragColor = texelFetch(groupTexture, ivec2(gl_FragCoord.xy), 0) * translucentGroup.opacity;
}
`;

/** Lays a group's offscreen markers onto the map as one sheet at `opacity`, then clears them
 *  for the next frame. Overlapping members never stack, and whatever is under the sheet shows
 *  through. Draws after every member of its group. */
export class TranslucentGroupLayer extends Layer<{ group: string; opacity: number }> {
	static layerName = "TranslucentGroupLayer";
	declare state: { model?: ClipSpace };

	initializeState() {
		this.state.model = new ClipSpace(this.context.device, {
			id: this.props.id,
			fs: compositeFs,
			modules: [groupUniforms],
			parameters: {
				depthCompare: "always",
				depthWriteEnabled: false,
				blend: true,
				blendColorOperation: "add",
				blendColorSrcFactor: "one",
				blendColorDstFactor: "one-minus-src-alpha",
				blendAlphaOperation: "add",
				blendAlphaSrcFactor: "one",
				blendAlphaDstFactor: "one-minus-src-alpha",
			},
		});
	}

	draw() {
		const { device } = this.context;
		const fbo = groupFramebuffer(device, this.props.group);
		const model = this.state.model!;
		model.setBindings({ groupTexture: fbo.colorAttachments[0].texture });
		// Same gamma deck applies to its own opacity prop, so the slider feels identical.
		model.shaderInputs.setProps({
			translucentGroup: { opacity: Math.pow(this.props.opacity, 1 / 2.2) },
		});
		model.draw(this.context.renderPass);
		device
			.beginRenderPass({
				framebuffer: fbo,
				clearColor: [0, 0, 0, 0],
				clearDepth: false,
				clearStencil: false,
			})
			.end();
	}

	finalizeState(context: LayerContext) {
		super.finalizeState(context);
		this.state.model?.destroy();
		const byGroup = groups.get(context.device);
		byGroup?.get(this.props.group)?.destroy();
		byGroup?.delete(this.props.group);
	}
}

/** Builds a group of layers at `opacity`. Translucent groups draw offscreen and land on the
 *  map as one sheet, so their own overlaps stay uniform without hiding what is beneath. */
export function translucentGroup(
	group: string,
	opacity: number,
	build: (group: string | null) => Layer[],
): Layer[] {
	if (opacity <= 0) return [];
	if (opacity >= 1) return build(null);
	const members = build(group);
	if (members.length === 0) return [];
	return [
		...members,
		new TranslucentGroupLayer({ id: `${group}:composite`, group, opacity, pickable: false }),
	];
}
