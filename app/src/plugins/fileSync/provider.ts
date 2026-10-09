import { mdiFileSyncOutline } from "@mdi/js";
import { createSyncController } from "@/lib/sync/controller";
import type { SyncProvider } from "@/lib/sync/provider";
import { msg } from "@/lib/i18n";

export const PLUGIN_ID = "file-sync";

const isUrl = (address: string): boolean => /^https?:\/\//.test(address);

export const fileProvider: SyncProvider = {
	id: "file",
	label: msg("File sync"),
	icon: mdiFileSyncOutline,
	remoteMapUrl: (address) => (isUrl(address) ? address : null),
};

export const controller = createSyncController(fileProvider, PLUGIN_ID);
