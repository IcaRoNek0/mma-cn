/**
 * Flags functions that guard `if (!currentMap) return` before calling `mutate()`.
 * mutate() handles the guard internally via EMPTY_MUTATION - caller guards are redundant.
 */
function bodyStatements(node) {
	if (node.body?.type === "BlockStatement") return node.body.body;
	return null;
}

function isCurrentMapGuard(stmt) {
	if (stmt.type !== "IfStatement") return false;
	const src = extractSource(stmt.test);
	return src.includes("currentMap") && !src.includes("currentMap.");
}

function extractSource(node) {
	if (node.type === "UnaryExpression" && node.operator === "!") return extractSource(node.argument);
	if (node.type === "Identifier") return node.name;
	if (node.type === "LogicalExpression")
		return extractSource(node.left) + " " + extractSource(node.right);
	return "";
}

function containsMutateCall(node) {
	if (!node) return false;
	if (node.type === "CallExpression") {
		if (node.callee.type === "Identifier" && node.callee.name === "mutate") return true;
		if (node.callee.type === "MemberExpression" && node.callee.property.name === "mutate")
			return true;
	}
	if (node.type === "AwaitExpression") return containsMutateCall(node.argument);
	if (node.type === "ExpressionStatement") return containsMutateCall(node.expression);
	if (node.type === "VariableDeclaration")
		return node.declarations.some((d) => containsMutateCall(d.init));
	if (node.type === "ReturnStatement") return containsMutateCall(node.argument);
	return false;
}

export default {
	meta: {
		type: "suggestion",
		messages: {
			redundantGuard:
				"Redundant `if (!currentMap)` guard before mutate() - mutate handles the guard internally via EMPTY_MUTATION.",
		},
	},
	create(context) {
		return {
			":function"(node) {
				const stmts = bodyStatements(node);
				if (!stmts || stmts.length < 2) return;
				for (let i = 0; i < stmts.length - 1; i++) {
					if (!isCurrentMapGuard(stmts[i])) continue;
					for (let j = i + 1; j < stmts.length; j++) {
						if (containsMutateCall(stmts[j])) {
							context.report({ node: stmts[i], messageId: "redundantGuard" });
							break;
						}
					}
				}
			},
		};
	},
};
