import { useMemo, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Dialog, DialogContent } from "@/components/primitives/Dialog";
import { TextInput } from "@/components/primitives/TextInput";
import { useT } from "@/lib/i18n";
import { toast } from "@/lib/util/toast";
import { createTags, getVisibleTags, useMapState } from "@/store/useMapStore";
import { getRecentTags, rememberRecentTag } from "./recentTagsStore";

function normalizeTagName(name: string): string {
	return name
		.trim()
		.replace(/^\/+|\/+$/g, "")
		.replace(/\/{2,}/g, "/");
}

export function AddTagPanel({
	open,
	onOpenChange,
	locationIds,
	title,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	locationIds: number[];
	title?: string;
}) {
	const { t } = useT();
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [recent, setRecent] = useState(() => getRecentTags());
	const appTags = useMapState(getVisibleTags);

	const trimmed = normalizeTagName(name);
	const query = trimmed.toLowerCase();

	const filteredRecent = useMemo(() => {
		if (!query) return recent;
		return recent.filter((n) => n.toLowerCase().includes(query));
	}, [recent, query]);

	const filteredAppTags = useMemo(() => {
		const recentLower = new Set(recent.map((n) => n.toLowerCase()));
		const list = appTags.filter((tag) => !recentLower.has(tag.name.toLowerCase()));
		if (!query) return list.slice(0, 12);
		return list.filter((tag) => tag.name.toLowerCase().includes(query)).slice(0, 12);
	}, [appTags, recent, query]);

	const applyTag = async (raw: string) => {
		const tagName = normalizeTagName(raw);
		if (!tagName || busy || locationIds.length === 0) return;
		setBusy(true);
		try {
			await createTags([tagName], locationIds);
			setRecent(rememberRecentTag(tagName));
			toast(
				locationIds.length === 1
					? t("Tagged with “{tag}”", { tag: tagName })
					: t("Tagged {count} locations with “{tag}”", {
							tag: tagName,
							count: String(locationIds.length),
						}),
			);
			setName("");
			onOpenChange(false);
		} catch (err) {
			toast(err instanceof Error ? err.message : t("Failed to add tag"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) setName("");
				onOpenChange(next);
			}}
		>
			<DialogContent title={title ?? t("Add tag")} className="gg-add-tag-dialog">
				<form
					className="gg-add-tag-dialog__form"
					onSubmit={(e) => {
						e.preventDefault();
						void applyTag(trimmed);
					}}
				>
					<TextInput
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder={t("Tag name…")}
						autoFocus
						disabled={busy}
					/>

					{filteredRecent.length > 0 && (
						<div className="gg-add-tag-dialog__section">
							<div className="gg-add-tag-dialog__label">{t("Recent tags")}</div>
							<div className="gg-add-tag-dialog__chips">
								{filteredRecent.map((tag) => (
									<button
										key={tag}
										type="button"
										className="gg-add-tag-dialog__chip gg-add-tag-dialog__chip--recent"
										disabled={busy}
										onClick={() => void applyTag(tag)}
									>
										{tag}
									</button>
								))}
							</div>
						</div>
					)}

					{filteredAppTags.length > 0 && (
						<div className="gg-add-tag-dialog__section">
							<div className="gg-add-tag-dialog__label">{t("Map tags")}</div>
							<div className="gg-add-tag-dialog__chips">
								{filteredAppTags.map((tag) => (
									<button
										key={tag.id}
										type="button"
										className="gg-add-tag-dialog__chip"
										disabled={busy}
										onClick={() => void applyTag(tag.name)}
										style={{ borderColor: tag.color || undefined }}
									>
										{tag.name}
									</button>
								))}
							</div>
						</div>
					)}

					<div className="gg-add-tag-dialog__actions">
						<Button type="button" onClick={() => onOpenChange(false)} disabled={busy}>
							{t("Cancel")}
						</Button>
						<Button variant="primary" type="submit" disabled={!trimmed || busy}>
							{t("Add tag")}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
