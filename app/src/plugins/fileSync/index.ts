const { registerPlugin } = window.MMA;
import { mdiFileSyncOutline } from "@mdi/js";
import { FileSyncSidebar } from "./FileSyncSidebar";
import { controller, PLUGIN_ID } from "./provider";
import { activateSyncPlugin } from "@/lib/sync/controller";
import { msg } from "@/lib/i18n";

registerPlugin({
	id: PLUGIN_ID,
	name: "File sync",
	description: msg("Keep a map up to date with a map file on disk or at a URL"),
	icon: mdiFileSyncOutline,
	experimental: true,
	sidebar: FileSyncSidebar,
	activate: () => activateSyncPlugin(controller),
});
