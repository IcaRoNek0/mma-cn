import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import rule from "../../lint-rules/no-native-dialog.js";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
	eslintCompat: true,
	languageOptions: { parserOptions: { lang: "ts" } },
});

const nativeDialog = [{ messageId: "nativeDialog" }];

tester.run("no-native-dialog", rule as never, {
	valid: [
		"function confirm(x) { return x; }\nexport const a = confirm(1);",
		'import { confirm } from "@/lib/ui";\nexport const a = confirm("sure?");',
		"const prompt = (s) => s;\nexport const a = prompt('hi');",
		"declare const dialogs: any;\nexport const a = dialogs.prompt('hi');",
		"declare const obj: any;\nexport const a = obj.window.alert('hi');",
	],
	invalid: [
		{ code: "export const a = confirm('sure?');", errors: nativeDialog },
		{ code: "export const a = alert('hi');", errors: nativeDialog },
		{ code: "export const a = prompt('name', 'x');", errors: nativeDialog },
		{ code: "export const a = window.prompt('name', 'x');", errors: nativeDialog },
		{ code: "export const a = window.confirm('sure?');", errors: nativeDialog },
		{ code: "export const a = globalThis.alert('hi');", errors: nativeDialog },
		{ code: "export const a = self.confirm('sure?');", errors: nativeDialog },
	],
});
