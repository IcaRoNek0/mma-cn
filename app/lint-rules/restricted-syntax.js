/** Reports every node matching a configured selector with that selector's message. */
export default {
	meta: {
		type: "problem",
		schema: {
			type: "array",
			items: {
				type: "object",
				properties: { selector: { type: "string" }, message: { type: "string" } },
				required: ["selector", "message"],
				additionalProperties: false,
			},
			uniqueItems: true,
		},
	},
	create(context) {
		return Object.fromEntries(
			context.options.map(({ selector, message }) => [
				selector,
				(node) => context.report({ node, message }),
			]),
		);
	},
};
