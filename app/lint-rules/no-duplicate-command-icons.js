export default {
	meta: {
		type: "problem",
		messages: {
			duplicate:
				"Icon '{{icon}}' is already used by command '{{first}}'. Each command should have a unique icon.",
		},
	},
	create(context) {
		return {
			"VariableDeclarator[id.name='COMMANDS']"(declarator) {
				let node = declarator.init;
				while (node && node.type === "TSSatisfiesExpression") node = node.expression;
				if (!node || node.type !== "ObjectExpression") return;

				const seen = new Map();
				for (const prop of node.properties) {
					if (prop.type !== "Property" || prop.value.type !== "ObjectExpression") continue;
					const iconProp = prop.value.properties.find(
						(p) => p.type === "Property" && p.key.type === "Identifier" && p.key.name === "icon",
					);
					if (!iconProp || iconProp.value.type !== "Identifier") continue;
					const icon = iconProp.value.name;
					const cmdName = prop.key.type === "Literal" ? prop.key.value : prop.key.name;
					if (seen.has(icon)) {
						context.report({
							node: iconProp.value,
							messageId: "duplicate",
							data: { icon, first: seen.get(icon) },
						});
					} else {
						seen.set(icon, cmdName);
					}
				}
			},
		};
	},
};
