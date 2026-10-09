import { createElement, useCallback } from "react";
import type { DocBlock, InlineMarks, InlineSpan } from "@/lib/doclink";
import { openHref } from "@/lib/map/mapClick";
import { clamp } from "@/types/util";
import { t } from "@/lib/i18n";

function spanStyle(m: InlineMarks): React.CSSProperties | undefined {
	const style: React.CSSProperties = {};
	if (m.bold) style.fontWeight = 700;
	if (m.italic) style.fontStyle = "italic";
	const deco = [m.underline && "underline", m.strike && "line-through"].filter(Boolean);
	if (deco.length) style.textDecoration = deco.join(" ");
	if (m.color) style.color = m.color;
	if (m.highlight) {
		style.backgroundColor = m.highlight;
		// Doc highlights assume light-theme text.
		if (!m.color) style.color = "#111";
	}
	if (m.sup || m.sub) {
		style.verticalAlign = m.sup ? "super" : "sub";
		style.fontSize = "0.75em";
	}
	return Object.keys(style).length ? style : undefined;
}

function Spans({ spans }: { spans: InlineSpan[] }) {
	return (
		<>
			{spans.map((s, i) => {
				const style = s.marks ? spanStyle(s.marks) : undefined;
				if (s.marks?.link) {
					return (
						<a key={i} href={s.marks.link} style={style}>
							{s.text}
						</a>
					);
				}
				return style ? (
					<span key={i} style={style}>
						{s.text}
					</span>
				) : (
					s.text
				);
			})}
		</>
	);
}

function Block({ block }: { block: DocBlock }) {
	switch (block.kind) {
		case "heading":
			return createElement(
				`h${clamp(block.level, 1, 6)}`,
				{ id: block.anchor },
				<Spans spans={block.spans} />,
			);
		case "paragraph":
			return (
				<p style={block.align ? { textAlign: block.align } : undefined}>
					<Spans spans={block.spans} />
				</p>
			);
		case "list":
			return createElement(
				block.ordered ? "ol" : "ul",
				null,
				block.items.map((item, i) => (
					<li key={i} style={item.depth ? { marginLeft: `${item.depth * 1.25}rem` } : undefined}>
						<Spans spans={item.spans} />
					</li>
				)),
			);
		case "image":
			return (
				<img
					src={block.src}
					alt={block.alt}
					width={block.width}
					height={block.height}
					crossOrigin="anonymous"
				/>
			);
		case "hr":
			return <hr />;
		case "placeholder":
			return <p className="doclink-native__placeholder">{t(block.note)}</p>;
	}
}

export function DocRenderer({ blocks }: { blocks: DocBlock[] }) {
	const onClick = useCallback((e: React.MouseEvent) => {
		const a = (e.target as Element).closest("a");
		if (!a?.href) return;
		e.preventDefault();
		void openHref(a.href);
	}, []);

	return (
		<div className="doclink-native" onClick={onClick}>
			{blocks.map((b, i) => (
				<Block key={i} block={b} />
			))}
		</div>
	);
}
