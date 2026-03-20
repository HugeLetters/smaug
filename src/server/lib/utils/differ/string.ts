import * as Chunk from "effect/Chunk";
import * as Data from "effect/Data";
import type * as Differ from "effect/Differ";
import * as Equal from "effect/Equal";
import * as Match from "effect/Match";
import { Format } from "./format.export";
import {
	type AndThenPatch,
	combine,
	type EmptyPatch,
	empty,
	makeDiffer,
} from "./shared";

class ReplacePatch extends Data.TaggedClass("Replace")<{
	readonly from: string;
	readonly to: string;
}> {}
class AppendedPatch extends Data.TaggedClass("Appended")<{
	readonly appended: string;
}> {}
class UnappendedPatch extends Data.TaggedClass("Unappended")<{
	readonly unappended: string;
}> {}
class PrependedPatch extends Data.TaggedClass("Prepended")<{
	readonly prepended: string;
}> {}
class UnprependedPatch extends Data.TaggedClass("Unprepended")<{
	readonly unprepended: string;
}> {}

export type Patch =
	| EmptyPatch
	| AndThenPatch<Patch>
	| ReplacePatch
	| AppendedPatch
	| UnappendedPatch
	| PrependedPatch
	| UnprependedPatch;

export const differ: Differ.Differ<string, Patch> = makeDiffer({
	empty,
	diff(oldValue, newValue) {
		if (Equal.equals(oldValue, newValue)) {
			return differ.empty;
		}

		if (newValue.startsWith(oldValue)) {
			return new AppendedPatch({ appended: newValue.slice(oldValue.length) });
		}

		if (oldValue.startsWith(newValue)) {
			return new UnappendedPatch({
				unappended: oldValue.slice(newValue.length),
			});
		}

		if (newValue.endsWith(oldValue)) {
			return new PrependedPatch({
				prepended: newValue.slice(0, -oldValue.length),
			});
		}

		if (oldValue.endsWith(newValue)) {
			return new UnprependedPatch({
				unprepended: oldValue.slice(newValue.length),
			});
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
			case "Appended":
				return `${oldValue}${patch.appended}`;
			case "Prepended":
				return `${patch.prepended}${oldValue}`;
			case "Unappended":
				return oldValue.slice(0, -patch.unappended.length);
			case "Unprepended":
				return oldValue.slice(patch.unprepended.length);
		}

		return patch satisfies never;
	},
});

export function formatTree(patch: Patch): Format.Tree {
	return Match.value(patch).pipe(
		Match.withReturnType<Format.Tree>(),
		Match.tagsExhaustive({
			Empty: () => Format.empty,
			AndThen: (patch) => {
				const first = formatTree(patch.first);
				const second = formatTree(patch.second);
				return {
					_tag: "Sequence",
					patch: Chunk.make(first, second),
				};
			},
			Replace: (patch) => ({
				_tag: "Unit",
				content: `Replace: ${Format.formatValue(patch.from)} ~> ${Format.formatValue(patch.to)}`,
			}),
			Appended: (patch) => ({
				_tag: "Unit",
				content: `Appended: ${Format.formatValue(patch.appended)}`,
			}),
			Unappended: (patch) => ({
				_tag: "Unit",
				content: `Unappended: ${Format.formatValue(patch.unappended)}`,
			}),
			Prepended: (patch) => ({
				_tag: "Unit",
				content: `Prepended: ${Format.formatValue(patch.prepended)}`,
			}),
			Unprepended: (patch) => ({
				_tag: "Unit",
				content: `Unprepended: ${Format.formatValue(patch.unprepended)}`,
			}),
		}),
	);
}

export function format(patch: Patch) {
	return Format.drawTree(formatTree(patch));
}
