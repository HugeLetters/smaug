import type * as Differ from "effect/Differ";
import * as HashMap from "effect/HashMap";
import * as Record from "effect/Record";
import { Format } from "./format.export";
import { HashMapDiffer } from "./hash-map.export";
import { makeDiffer } from "./shared";

export type Patch<TValue, TPatch> = HashMapDiffer.Patch<string, TValue, TPatch>;

type Value<TValue> = Record.ReadonlyRecord<string, TValue>;

export function differ<TValue, TPatch>(
	valueDiffer: Differ.Differ<TValue, TPatch>,
) {
	const hmDiffer = HashMapDiffer.differ<string, TValue, TPatch>(valueDiffer);

	return makeDiffer({
		empty: hmDiffer.empty,
		diff(oldValue: Value<TValue>, newValue) {
			return hmDiffer.diff(
				HashMap.fromIterable(Object.entries(oldValue)),
				HashMap.fromIterable(Object.entries(newValue)),
			);
		},
		combine: hmDiffer.combine,
		patch(oldValue, patch: Patch<TValue, TPatch>) {
			return hmDiffer
				.patch(HashMap.fromIterable(Object.entries(oldValue)), patch)
				.pipe(Record.fromEntries);
		},
	});
}

export function formatTree<P>(
	patch: Patch<unknown, P>,
	formatPatchTree: (patch: P) => Format.Tree,
): Format.Tree {
	return HashMapDiffer.formatTree(patch, formatPatchTree);
}

export function format<P>(
	patch: Patch<unknown, P>,
	formatPatchTree: (patch: P) => Format.Tree,
) {
	return Format.drawTree(formatTree(patch, formatPatchTree));
}
