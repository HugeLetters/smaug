import type * as Differ from "effect/Differ";
import * as HashMap from "effect/HashMap";
import { Format } from "./format.export";
import { HashMapDiffer } from "./hash-map.export";
import { makeDiffer } from "./shared";

export type Patch<TKey, TValue, TPatch> = HashMapDiffer.Patch<
	TKey,
	TValue,
	TPatch
>;

export function differ<TKey, TValue, TPatch>(
	valueDiffer: Differ.Differ<TValue, TPatch>,
) {
	const hmDiffer = HashMapDiffer.differ<TKey, TValue, TPatch>(valueDiffer);
	return makeDiffer({
		empty: hmDiffer.empty,
		diff(oldValue: ReadonlyMap<TKey, TValue>, newValue) {
			return hmDiffer.diff(
				HashMap.fromIterable(oldValue),
				HashMap.fromIterable(newValue),
			);
		},
		combine: hmDiffer.combine,
		patch(oldValue, patch: Patch<TKey, TValue, TPatch>) {
			return hmDiffer
				.patch(HashMap.fromIterable(oldValue), patch)
				.pipe((hm) => new Map(hm));
		},
	});
}

export function formatTree<P>(
	patch: Patch<unknown, unknown, P>,
	formatPatchTree: (patch: P) => Format.Tree,
): Format.Tree {
	return HashMapDiffer.formatTree(patch, formatPatchTree);
}

export function format<P>(
	patch: Patch<unknown, unknown, P>,
	formatPatchTree: (patch: P) => Format.Tree,
) {
	return Format.drawTree(formatTree(patch, formatPatchTree));
}
