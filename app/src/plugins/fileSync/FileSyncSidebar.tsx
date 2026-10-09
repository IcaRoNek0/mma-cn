import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { SyncSidebar } from "@/lib/sync/ui/SyncSidebar";
import { t } from "@/lib/i18n";
import { controller } from "./provider";

const NO_ACCOUNT = { id: null };

const fileName = (address: string): string => address.split(/[\\/]/).pop() || address;

export function FileSyncSidebar({ onClose }: { onClose: () => void }) {
	return (
		<SyncSidebar
			onClose={onClose}
			controller={controller}
			identity={NO_ACCOUNT}
			source={{
				kind: "address",
				placeholder: t("Path or URL of a map file"),
				browse: async () => {
					const picked = await openDialog({
						filters: [{ name: t("Map data"), extensions: ["json", "csv"] }],
					});
					return typeof picked === "string" ? picked : null;
				},
				resolve: async (address) => {
					const source = await window.MMA.cmd.fileSourceProbe(address);
					return {
						id: address,
						name: source.name || fileName(address),
						locationCount: source.locationCount,
					};
				},
			}}
		/>
	);
}
