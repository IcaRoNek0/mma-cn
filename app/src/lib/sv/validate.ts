import type { Selector } from "@/bindings.gen";
import { ValidationFlag } from "@/bindings.consts";
import type { ProcedureSpec } from "@/lib/data/fieldDefs";
import {
	procedureEntry,
	runProcedure,
	type BatchOutcome,
	type BulkOpts,
} from "@/lib/data/procedures";
import { SV_SEARCH_RADIUS } from "@/lib/sv/constants";
import { log } from "@/lib/util/log";
import { msg } from "@/lib/i18n";

/** Configuration for Street View validation: the radius of the coordinate lookup. */
export interface ValidateConfig {
	radius: number;
}

/** Street View coverage validation. Checks each location's stored pano, coordinate
 *  lookup, unofficial status, camera quality, and timeline. Answers with the
 *  `ValidationFlag`s that apply to each location without writing anything. */
const validateSpec: ProcedureSpec<number, ValidateConfig> = {
	entry: procedureEntry("validate"),
	batch: { mode: "chunk", size: 200 },
	sink: "collect",
	config: { radius: SV_SEARCH_RADIUS },
};

const FLAGS = Object.values(ValidationFlag).filter((f) => f !== ValidationFlag.None);
const KNOWN_BITS = FLAGS.reduce<number>((all, f) => all | f, 0);

/** What a validation run answered: the ids carrying each flag, and under
 *  `ValidationFlag.None` the ids with none, over the outcome every run reports. */
export interface ValidationOutcome extends BatchOutcome {
	flags: Map<ValidationFlag, number[]>;
}

/** Check that each location's Street View coverage still exists. */
export async function validateLocations(
	selector: Selector,
	opts: BulkOpts & { config?: Partial<ValidateConfig> } = {},
): Promise<ValidationOutcome> {
	const run = await runProcedure(validateSpec, selector, {
		id: "validate",
		label: msg("Validating"),
		...opts,
	});

	const results = new Map<ValidationFlag, number[]>();
	const add = (flag: ValidationFlag, id: number) => {
		const list = results.get(flag);
		if (list) list.push(id);
		else results.set(flag, [id]);
	};
	for (const { id, value: bits } of run.collected ?? []) {
		if ((bits & ~KNOWN_BITS) !== 0) {
			log.warn(`[validate] location ${id}: unknown validation flags ${String(bits)}`);
			continue;
		}
		if (bits === ValidationFlag.None) add(ValidationFlag.None, id);
		for (const flag of FLAGS) if (bits & flag) add(flag, id);
	}
	return { succeeded: run.succeeded, failed: run.failed, flags: results };
}
