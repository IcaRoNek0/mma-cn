import { useState } from "react";
import type { AutoTagOptions } from "@/bindings.gen";
import {
	Dialog,
	DialogActions,
	DialogContent,
	type DialogProps,
} from "@/components/primitives/Dialog";
import { Checkbox } from "@/components/primitives/Checkbox";
import { autoTag, mergePanoDuplicates, previewPanoDuplicates } from "@/store/useMapStore";
import { useAsync } from "@/lib/hooks/useAsync";
import { t } from "@/lib/i18n";
import { log } from "@/lib/util/log";

export function MergePanoDuplicatesDialog({ open, onOpenChange }: DialogProps) {
	const [busy, setBusy] = useState(false);
	const { data: preview, loading } = useAsync(
		async () => (open ? previewPanoDuplicates() : null),
		[open],
	);
	async function apply() {
		setBusy(true);
		try {
			await mergePanoDuplicates();
			onOpenChange(false);
		} catch (error) {
			log.error("[pano-dedup] failed", error);
		} finally {
			setBusy(false);
		}
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title={t("Merge duplicate pano IDs")}>
				<p className="modal__message">
					{t(
						"Identical non-empty pano IDs are merged across the whole map. Tags are combined. This edit can be undone.",
					)}
				</p>
				<p className="modal__message">
					{loading
						? t("Loading...")
						: preview
							? t("Duplicate groups: {groups}. Locations removed: {removed}.", preview)
							: t("Could not load preview.")}
				</p>
				<DialogActions
					cancel
					primary={{
						label: busy ? t("Merging...") : t("Merge"),
						disabled: loading || busy || !preview?.groups,
						onClick: () => void apply(),
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}

export function AutoTagDialog({ open, onOpenChange }: DialogProps) {
	const [options, setOptions] = useState<AutoTagOptions>({
		source: true,
		vehicle: false,
		year: false,
		season: false,
		month: false,
	});
	const [busy, setBusy] = useState(false);
	const choices: [keyof AutoTagOptions, string][] = [
		["source", t("Source tag")],
		["vehicle", t("Street View vehicle tag")],
		["year", t("Year tag (2014年)")],
		["season", t("Season tag (2014年冬季)")],
		["month", t("Month tag (2022年8月)")],
	];
	async function apply() {
		setBusy(true);
		try {
			await autoTag(options);
			onOpenChange(false);
		} catch (error) {
			log.error("[auto-tag] failed", error);
		} finally {
			setBusy(false);
		}
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title={t("Auto Tag")}>
				<p className="modal__message">
					{t(
						"Add tags across the whole map. Choose any combination. Existing tags are preserved; missing or invalid capture times are skipped.",
					)}
				</p>
				{choices.map(([key, label]) => (
					<Checkbox
						key={key}
						checked={options[key]}
						disabled={busy}
						onChange={(e) => setOptions({ ...options, [key]: e.target.checked })}
					>
						{label}
					</Checkbox>
				))}
				<p className="modal__message">
					{t(
						"Seasons: March–May spring, June–August summer, September–November autumn, December–February winter. The year follows the capture date.",
					)}
				</p>
				<DialogActions
					cancel
					primary={{
						label: busy ? t("Applying...") : t("Apply"),
						disabled: busy || !Object.values(options).some(Boolean),
						onClick: () => void apply(),
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}
