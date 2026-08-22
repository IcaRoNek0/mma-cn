const { registerPlugin } = window.MMA;
import { GameSidebar } from "./GameSidebar";
import { mdiGamepadVariantOutline } from "@mdi/js";

registerPlugin({
	id: "localguessr",
	name: "LocalGuessr",
	description: "Play GeoGuessr games with your own map locations",
	icon: mdiGamepadVariantOutline,
	core: true,
	activate() {},
	sidebar: GameSidebar,
});
