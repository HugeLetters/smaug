import * as Chunk from "effect/Chunk";
import * as Data from "effect/Data";
import type * as Differ from "effect/Differ";
import * as Equal from "effect/Equal";
import * as Match from "effect/Match";
import { formatValue } from "./format";
import { Format } from "./format.export";
import {
	type AndThenPatch,
	combine,
	type EmptyPatch,
	empty,
	makeDiffer,
} from "./shared";

class ReplacePatch extends Data.TaggedClass("Replace")<{
	readonly from: unknown;
	readonly to: unknown;
}> {}

export type Patch = EmptyPatch | AndThenPatch<Patch> | ReplacePatch;

export const differ: Differ.Differ<unknown, Patch> = makeDiffer({
	empty,
	diff(oldValue, newValue) {
		if (Equal.equals(oldValue, newValue)) {
			return differ.empty;
		}

		return new ReplacePatch({ from: oldValue, to: newValue });
	},
	combine,
	patch(oldValue, patch) {
		switch (patch._tag) {
			case "Empty":
				return oldValue;
			case "AndThen": {
				const first = differ.patch(oldValue, patch.first);
				return differ.patch(first, patch.second);
			}
			case "Replace":
				return patch.to;
		}

		return patch satisfies never;
	},
});

export function formatTree(patch: Patch): Format.Tree {
	return Match.value(patch).pipe(
		Match.withReturnType<Format.Tree>(),
		Match.tagsExhaustive({
			Empty() {
				return Format.empty;
			},
			AndThen(patch) {
				const first = formatTree(patch.first);
				const second = formatTree(patch.second);
				return {
					_tag: "Sequence",
					patch: Chunk.make(first, second),
				};
			},
			Replace(patch) {
				return {
					_tag: "Unit",
					content: `Replace: ${formatValue(patch.from)} ~> ${formatValue(patch.to)}`,
				};
			},
		}),
	);
}

export function format(patch: Patch) {
	return Format.drawTree(formatTree(patch));
}
