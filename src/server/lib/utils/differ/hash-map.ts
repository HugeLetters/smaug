import * as Chunk from "effect/Chunk";
import * as Data from "effect/Data";
import type * as Differ from "effect/Differ";
import * as Equal from "effect/Equal";
import * as HashMap from "effect/HashMap";
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

class AddPatch<TKey, TValue> extends Data.TaggedClass("Add")<{
	readonly key: TKey;
	readonly value: TValue;
}> {}

class RemovePatch<TKey> extends Data.TaggedClass("Remove")<{
	readonly key: TKey;
}> {}

class UpdatePatch<TKey, TPatch> extends Data.TaggedClass("Update")<{
	readonly key: TKey;
	readonly patch: TPatch;
}> {}

export type Patch<TKey, TValue, TPatch> =
	| EmptyPatch
	| AndThenPatch<Patch<TKey, TValue, TPatch>>
	| AddPatch<TKey, TValue>
	| RemovePatch<TKey>
	| UpdatePatch<TKey, TPatch>;

export function differ<TKey, TValue, TPatch>(
	valueDiffer: Differ.Differ<TValue, TPatch>,
) {
	const differ: Differ.Differ<
		HashMap.HashMap<TKey, TValue>,
		Patch<TKey, TValue, TPatch>
	> = makeDiffer({
		empty,
		diff(oldValue, newValue) {
			const [removed, patch] = HashMap.reduce(
				newValue,
				[oldValue, differ.empty] as const,
				([map, patch], newValue, key) => {
					const option = HashMap.get(map, key);
					switch (option._tag) {
						case "Some": {
							const valuePatch = valueDiffer.diff(option.value, newValue);
							if (Equal.equals(valuePatch, valueDiffer.empty)) {
								return [HashMap.remove(map, key), patch] as const;
							}

							return [
								HashMap.remove(map, key),
								differ.combine(
									patch,
									new UpdatePatch({ key, patch: valuePatch }),
								),
							] as const;
						}

						case "None": {
							return [
								map,
								differ.combine(patch, new AddPatch({ key, value: newValue })),
							] as const;
						}
					}
				},
			);

			return HashMap.reduce(removed, patch, (patch, _, key) =>
				differ.combine(patch, new RemovePatch({ key })),
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
					return HashMap.set(oldValue, patch.key, patch.value);
				case "Remove":
					return HashMap.remove(oldValue, patch.key);
				case "Update": {
					const option = HashMap.get(oldValue, patch.key);

					if (Option.isNone(option)) {
						return oldValue;
					}

					return HashMap.set(
						oldValue,
						patch.key,
						valueDiffer.patch(option.value, patch.patch),
					);
				}
			}

			return patch satisfies never;
		},
	});

	return differ;
}

export function formatTree<P>(
	patch: Patch<unknown, unknown, P>,
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
			Remove: (patch) => ({
				_tag: "Unit",
				content: `Remove: ${Format.formatValue(patch.key)}`,
			}),
			Add: (patch) => ({
				_tag: "Unit",
				content: `Add: ${Format.formatValue(patch.key)} ~> ${Format.formatValue(patch.value)}`,
			}),
			Update: (patch) => {
				const tree = formatPatchTree(patch.patch);
				return {
					_tag: "Nested",
					label: `Update: ${Format.formatValue(patch.key)}`,
					patch: tree,
				};
			},
		}),
	);
}

export function format<P>(
	patch: Patch<unknown, unknown, P>,
	formatPatchTree: (patch: P) => Format.Tree,
) {
	return Format.drawTree(formatTree(patch, formatPatchTree));
}
