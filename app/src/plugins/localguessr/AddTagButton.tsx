import { useState, type MouseEvent } from "react";
import { Icon } from "@/components/primitives/Icon";
import { Tooltip } from "@/components/primitives/Tooltip";
import { mdiTagPlusOutline } from "@mdi/js";
import { useT } from "@/lib/i18n";
import { AddTagPanel } from "./AddTagPanel";

export type AddTagButtonVariant = "result" | "summary-row" | "summary-bulk";

export function AddTagButton({
	locationIds,
	variant = "result",
	label,
}: {
	locationIds: number[];
	variant?: AddTagButtonVariant;
	/** Optional override for the trigger label (defaults by variant). */
	label?: string;
}) {
	const { t } = useT();
	const [open, setOpen] = useState(false);
	const disabled = locationIds.length === 0;

	const defaultLabel = variant === "summary-bulk" ? t("Tag all rounds") : t("Add tag");

	const triggerLabel = label ?? defaultLabel;

	const onTriggerClick = (e: MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();
		if (disabled) return;
		setOpen(true);
	};

	return (
		<>
			{variant === "result" ? (
				<button
					type="button"
					className="gg-add-tag-btn gg-add-tag-btn--result"
					onClick={onTriggerClick}
					disabled={disabled}
					aria-label={triggerLabel}
				>
					<Icon path={mdiTagPlusOutline} />
					<span>{triggerLabel}</span>
				</button>
			) : variant === "summary-row" ? (
				<Tooltip content={triggerLabel} side="left">
					<button
						type="button"
						className="gg-add-tag-btn gg-add-tag-btn--summary-row"
						onClick={onTriggerClick}
						disabled={disabled}
						aria-label={triggerLabel}
					>
						<Icon path={mdiTagPlusOutline} />
					</button>
				</Tooltip>
			) : (
				<button
					type="button"
					className="gg-add-tag-btn gg-add-tag-btn--summary-bulk"
					onClick={onTriggerClick}
					disabled={disabled}
					aria-label={triggerLabel}
				>
					<Icon path={mdiTagPlusOutline} />
					<span>{triggerLabel}</span>
				</button>
			)}
			<AddTagPanel
				open={open}
				onOpenChange={setOpen}
				locationIds={locationIds}
				title={variant === "summary-bulk" ? t("Tag all rounds") : t("Add tag")}
			/>
		</>
	);
}
