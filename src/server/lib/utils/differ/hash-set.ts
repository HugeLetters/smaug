import * as Chunk from "effect/Chunk";
import * as Data from "effect/Data";
import type * as Differ from "effect/Differ";
import * as HashSet from "effect/HashSet";
import * as Match from "effect/Match";
import { Format } from "./format.export";
import {
	type AndThenPatch,
	combine,
	type EmptyPatch,
	empty,
	makeDiffer,
} from "./shared";

class AddPatch extends Data.TaggedClass("Add")<{
	readonly value: unknown;
}> {}

class RemovePatch extends Data.TaggedClass("Remove")<{
	readonly value: unknown;
}> {}

export type Patch = EmptyPatch | AndThenPatch<Patch> | AddPatch | RemovePatch;

export const differ: Differ.Differ<
	HashSet.HashSet<unknown>,
	Patch
> = makeDiffer({
	empty,
	diff(oldValue, newValue) {
		const [removed, patch] = HashSet.reduce(
			newValue,
			[oldValue, differ.empty] as const,
			([set, patch], value) => {
				if (HashSet.has(value)(set)) {
					return [HashSet.remove(set, value), patch] as const;
				}

				return [set, differ.combine(patch, new AddPatch({ value }))] as const;
			},
		);

		return HashSet.reduce(removed, patch, (patch, value) =>
			differ.combine(patch, new RemovePatch({ value })),
		);
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
			case "Add":
				return HashSet.add(oldValue, patch.value);
			case "Remove":
				return HashSet.remove(oldValue, patch.value);
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
			Add: (patch) => ({
				_tag: "Unit",
				content: `Add: ${Format.formatValue(patch.value)}`,
			}),
			Remove: (patch) => ({
				_tag: "Unit",
				content: `Remove: ${Format.formatValue(patch.value)}`,
			}),
		}),
	);
}

export function format(patch: Patch) {
	return Format.drawTree(formatTree(patch));
}
