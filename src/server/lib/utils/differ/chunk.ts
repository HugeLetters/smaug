import * as Chunk from "effect/Chunk";
import * as Data from "effect/Data";
import type * as Differ from "effect/Differ";
import * as Equal from "effect/Equal";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import { Format } from "./format.export";
import {
	type AndThenPatch,
	combine,
	type EmptyPatch,
	empty,
	makeDiffer,
} from "./shared";

class AppendPatch<TValue> extends Data.TaggedClass("Append")<{
	readonly values: Chunk.Chunk<TValue>;
}> {}

class SlicePatch extends Data.TaggedClass("Slice")<{
	readonly from: number;
	readonly until: number;
}> {}

class UpdatePatch<TPatch> extends Data.TaggedClass("Update")<{
	readonly index: number;
	readonly patch: TPatch;
}> {}

export type Patch<TValue, TPatch> =
	| EmptyPatch
	| AndThenPatch<Patch<TValue, TPatch>>
	| AppendPatch<TValue>
	| SlicePatch
	| UpdatePatch<TPatch>;

export function differ<TValue, TPatch>(
	valueDiffer: Differ.Differ<TValue, TPatch>,
) {
	const differ: Differ.Differ<
		Chunk.Chunk<TValue>,
		Patch<TValue, TPatch>
	> = makeDiffer({
		empty,
		diff(oldValue, newValue) {
			let i = 0;
			let patch = differ.empty;
			while (i < oldValue.length && i < newValue.length) {
				const valuePatch = valueDiffer.diff(
					Chunk.getUnsafe(oldValue, i),
					Chunk.getUnsafe(newValue, i),
				);
				if (!Equal.equals(valuePatch, valueDiffer.empty)) {
					patch = differ.combine(
						patch,
						new UpdatePatch({ index: i, patch: valuePatch }),
					);
				}

				i++;
			}

			if (i < oldValue.length) {
				patch = differ.combine(patch, new SlicePatch({ from: 0, until: i }));
			}

			if (i < newValue.length) {
				patch = differ.combine(
					patch,
					new AppendPatch({ values: Chunk.drop(newValue, i) }),
				);
			}

			return patch;
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
				case "Append":
					return Chunk.appendAll(oldValue, patch.values);
				case "Slice": {
					const arr = Chunk.toArray(oldValue);
					return Chunk.fromArrayUnsafe(arr.slice(patch.from, patch.until));
				}
				case "Update": {
					const out = Chunk.modify(oldValue, patch.index, (value) =>
						valueDiffer.patch(value, patch.patch),
					);
					if (Option.isNone(out)) {
						return oldValue;
					}

					return out.value;
				}
			}

			return patch satisfies never;
		},
	});

	return differ;
}

export function formatTree<P>(
	patch: Patch<unknown, P>,
	formatPatchTree: (patch: P) => Format.Tree,
): Format.Tree {
	return Match.value(patch).pipe(
		Match.withReturnType<Format.Tree>(),
		Match.tagsExhaustive({
			Empty: () => Format.empty,
			AndThen: (patch) => {
				const first = formatTree(patch.first, formatPatchTree);
				const second = formatTree(patch.second, formatPatchTree);
				return {
					_tag: "Sequence",
					patch: Chunk.make(first, second),
				};
			},
			Append: (patch) => ({
				_tag: "Sequence",
				patch: Chunk.map(patch.values, (value) => ({
					_tag: "Unit",
					content: `Append: ${Format.formatValue(value)}`,
				})),
			}),
			Slice: (patch) => ({
				_tag: "Unit",
				content: `Slice: ${Format.formatValue(patch.from)} - ${Format.formatValue(patch.until)}`,
			}),
			Update: (patch) => {
				const tree = formatPatchTree(patch.patch);
				return {
					_tag: "Nested",
					label: `Update: ${Format.formatValue(patch.index)}`,
					patch: tree,
				};
			},
		}),
	);
}

export function format<P>(
	patch: Patch<unknown, P>,
	formatPatchTree: (patch: P) => Format.Tree,
) {
	return Format.drawTree(formatTree(patch, formatPatchTree));
}
