import { Layer, color, project32, picking } from "@deck.gl/core";
import { Model, Geometry } from "@luma.gl/engine";
import { sdfMarkerUniforms, type SDFMarkerProps } from "./sdf-marker-uniforms";
import { drawIntoGroup } from "@/lib/render/translucentGroup";
import vs from "./sdf-marker-vertex.glsl";
import fs from "./sdf-marker-fragment.glsl";

import type {
	LayerProps,
	LayerDataSource,
	UpdateParameters,
	Accessor,
	Position,
	Color,
	DefaultProps,
} from "@deck.gl/core";

export type SDFShape = "circle" | "arrow" | "pin";

const SHAPE_TO_INT: Record<SDFShape, number> = {
	circle: 0,
	arrow: 1,
	pin: 2,
};

type _SDFMarkerLayerProps<DataT> = {
	data: LayerDataSource<DataT>;
	shape?: SDFShape;
	radiusPixels?: number;
	/** Draw offscreen into this translucent group instead of straight onto the map. */
	translucentGroup?: string | null;
	getPosition?: Accessor<DataT, Position>;
	getFillColor?: Accessor<DataT, Color>;
	/** Per-marker visibility, unorm8: 255 draws, 0 hides. Omit for always-visible layers. */
	getVisible?: Accessor<DataT, number>;
	getAngle?: Accessor<DataT, number>;
	getRadius?: Accessor<DataT, number>;
};

export type SDFMarkerLayerProps<DataT = unknown> = _SDFMarkerLayerProps<DataT> & LayerProps;

const defaultProps: DefaultProps<SDFMarkerLayerProps> = {
	shape: "circle",
	radiusPixels: { type: "number", min: 0, value: 12 },
	translucentGroup: null,
	getPosition: { type: "accessor", value: [0, 0] },
	getFillColor: { type: "accessor", value: [0, 0, 0, 255] },
	// unorm8, so the "fully visible" constant is 255, matching getFillColor's alpha.
	getVisible: { type: "accessor", value: 255 },
	getAngle: { type: "accessor", value: 0 },
	// Prevent errors when transitioning from ScatterplotLayer on the same layer ID
	getRadius: { type: "accessor", value: 1 },
};

export default class SDFMarkerLayer<
	DataT = unknown,
	ExtraPropsT extends Record<string, unknown> = Record<string, unknown>,
> extends Layer<ExtraPropsT & Required<_SDFMarkerLayerProps<DataT>>> {
	static defaultProps = defaultProps;
	static layerName = "SDFMarkerLayer";

	declare state: { model?: Model };

	getShaders() {
		return super.getShaders({
			vs,
			fs,
			modules: [project32, color, picking, sdfMarkerUniforms],
		});
	}

	initializeState() {
		this.getAttributeManager()!.addInstanced({
			instancePositions: {
				size: 3,
				type: "float64",
				fp64: this.use64bitPositions(),
				transition: true,
				accessor: "getPosition",
			},
			instanceFillColors: {
				size: this.props.colorFormat.length,
				transition: true,
				type: "unorm8",
				accessor: "getFillColor",
				defaultValue: [0, 0, 0, 255],
			},
			instanceVisible: {
				size: 1,
				type: "unorm8",
				accessor: "getVisible",
				defaultValue: [255],
			},
			instanceAngles: {
				size: 1,
				transition: true,
				accessor: "getAngle",
			},
		});
	}

	updateState(params: UpdateParameters<this>) {
		super.updateState(params);
		if (params.changeFlags.extensionsChanged) {
			this.state.model?.destroy();
			this.state.model = this._getModel();
			this.getAttributeManager()!.invalidateAll();
		}
	}

	draw({ shaderModuleProps }: { shaderModuleProps?: { picking?: { isActive?: unknown } } }) {
		const { radiusPixels, shape, translucentGroup } = this.props;
		const model = this.state.model!;
		const sdfProps: SDFMarkerProps = {
			radiusPixels,
			shapeType: SHAPE_TO_INT[shape!] ?? 0,
			strokeWidthPixels: 1,
		};
		model.shaderInputs.setProps({ sdfMarker: sdfProps });
		if (translucentGroup && !shaderModuleProps?.picking?.isActive) {
			drawIntoGroup(this.context, translucentGroup, (pass) => model.draw(pass));
		} else {
			model.draw(this.context.renderPass);
		}
	}

	protected _getModel() {
		const positions = [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0];
		return new Model(this.context.device, {
			...this.getShaders(),
			id: this.props.id,
			bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
			geometry: new Geometry({
				topology: "triangle-strip",
				attributes: {
					positions: { size: 3, value: new Float32Array(positions) },
				},
			}),
			isInstanced: true,
		});
	}
}
