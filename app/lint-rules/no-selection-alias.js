/**
 * Flags exported functions whose body is solely `return applySelectionUpdate(...)` or
 * `applySelectionUpdate(...)`. These are trivial aliases - callers should apply the pure op
 * through applySelectionUpdate themselves.
 */
function isGateCall(node) {
	if (!node) return false;
	if (node.type === "CallExpression") {
		return node.callee.type === "Identifier" && node.callee.name === "applySelectionUpdate";
	}
	if (node.type === "AwaitExpression") return isGateCall(node.argument);
	return false;
}

export default {
	meta: {
		type: "suggestion",
		messages: {
			selectionAlias:
				"This function is a trivial alias over applySelectionUpdate(). Callers should apply the op directly: applySelectionUpdate(addSelection({ type: ... })).",
		},
	},
	create(context) {
		return {
			ExportNamedDeclaration(node) {
				const decl = node.declaration;
				if (!decl) return;

				let body;
				if (decl.type === "FunctionDeclaration") {
					body = decl.body?.body;
				} else if (decl.type === "VariableDeclaration") {
					const init = decl.declarations[0]?.init;
					if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") {
						body = init.body?.type === "BlockStatement" ? init.body.body : null;
						if (!body && isGateCall(init.body)) {
							context.report({ node: decl, messageId: "selectionAlias" });
							return;
						}
					}
				}
				if (!body || body.length !== 1) return;
				const stmt = body[0];
				if (stmt.type === "ReturnStatement" && isGateCall(stmt.argument)) {
					context.report({ node: decl, messageId: "selectionAlias" });
				}
				if (stmt.type === "ExpressionStatement" && isGateCall(stmt.expression)) {
					context.report({ node: decl, messageId: "selectionAlias" });
				}
			},
		};
	},
};
