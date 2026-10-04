import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import rule from "../../lint-rules/no-handrolled-dialog-parts.js";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
	eslintCompat: true,
	languageOptions: { parserOptions: { lang: "tsx" } },
});

const DIALOG = 'import { DialogContent } from "@/components/primitives/Dialog";\n';

tester.run("no-handrolled-dialog-parts", rule as never, {
	valid: [
		{ code: "export const a = <form onSubmit={() => {}} />;" },
		{ code: `${DIALOG}export const a = <DialogForm onSubmit={() => {}} />;` },
		{ code: 'export const a = <div style={{ justifyContent: "space-between" }} />;' },
		{
			code: `${DIALOG}export const a = <DialogContent title="x"><ul><li className="row__actions" /></ul></DialogContent>;`,
		},
		{ code: 'export const a = <div className="card__actions" />;' },
	],
	invalid: [
		{
			code: `${DIALOG}export const a = <form onSubmit={() => {}} />;`,
			errors: [{ messageId: "form" }],
		},
		{
			code: 'export const a = <div style={{ display: "flex", justifyContent: "flex-end" }} />;',
			errors: [{ messageId: "rightAligned" }],
		},
		{
			code: `${DIALOG}export const a = <DialogContent title="x"><div className="thing-dialog__actions" /></DialogContent>;`,
			errors: [{ messageId: "footerClass" }],
		},
		{
			code: `${DIALOG}export const a = <DialogContent title="x">{ok && <><div className="thing__footer" /></>}</DialogContent>;`,
			errors: [{ messageId: "footerClass" }],
		},
	],
});
