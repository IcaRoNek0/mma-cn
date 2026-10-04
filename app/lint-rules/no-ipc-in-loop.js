/**
 * Warn when an IPC command is called inside a loop — one Tauri round-trip per
 * iteration. Prefer a bulk command that lets Rust handle the batch internally.
 *
 * Flags `cmd.foo()` only when `cmd` resolves to the `@/lib/commands` import (so a
 * local `for (const cmd of ...)` keybinding object is NOT flagged), and `*.cmd.foo()`
 * (e.g. `api.cmd.foo()`). Only literal loops count; a parallel `xs.map(cmd.foo)` is
 * a deliberate judgement call and left alone.
 */
const LOOP_TYPES = new Set([
	"ForStatement",
	"ForInStatement",
	"ForOfStatement",
	"WhileStatement",
	"DoWhileStatement",
]);

const COMMANDS_MODULE = "@/lib/commands";

function isInLoop(node) {
	for (let n = node.parent; n; n = n.parent) {
		if (LOOP_TYPES.has(n.type)) return true;
	}
	return false;
}

function bindsToCommandsImport(idNode, context) {
	const sourceCode = context.sourceCode ?? context.getSourceCode();
	let scope = sourceCode.getScope(idNode);
	while (scope) {
		const variable = scope.variables.find((v) => v.name === "cmd");
		if (variable) {
			return variable.defs.some(
				(d) =>
					d.type === "ImportBinding" &&
					d.parent.type === "ImportDeclaration" &&
					d.parent.source.value === COMMANDS_MODULE,
			);
		}
		scope = scope.upper;
	}
	return false;
}

export default {
	meta: {
		type: "suggestion",
		messages: {
			ipcInLoop:
				"IPC command (cmd.*) called inside a loop — one round-trip per item. Add a bulk command and let Rust handle it internally. (eslint-disable-next-line with a reason if the loop is genuinely tiny/unavoidable.)",
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				if (node.callee.type !== "MemberExpression") return;
				const obj = node.callee.object;

				const isApiCmd =
					obj.type === "MemberExpression" &&
					obj.property.type === "Identifier" &&
					obj.property.name === "cmd";
				const isBareCmd =
					obj.type === "Identifier" && obj.name === "cmd" && bindsToCommandsImport(obj, context);

				if (!isApiCmd && !isBareCmd) return;
				if (!isInLoop(node)) return;

				context.report({ node, messageId: "ipcInLoop" });
			},
		};
	},
};
