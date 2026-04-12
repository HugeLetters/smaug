import type * as Differ from "effect/Differ";
import * as HashSet from "effect/HashSet";
import { Format } from "./format.export";
import { HashSetDiffer } from "./hash-set.export";
import { makeDiffer } from "./shared";

export type Patch = HashSetDiffer.Patch;

const hsDiffer = HashSetDiffer.differ;

export const differ: Differ.Differ<ReadonlySet<unknown>, Patch> = makeDiffer({
	empty: hsDiffer.empty,
	diff(oldValue, newValue) {
		return hsDiffer.diff(
			HashSet.fromIterable(oldValue),
			HashSet.fromIterable(newValue),
		);
	},
	combine: hsDiffer.combine,
	patch(oldValue, patch) {
		return new Set(hsDiffer.patch(HashSet.fromIterable(oldValue), patch));
	},
});

export function formatTree(patch: Patch): Format.Tree {
	return HashSetDiffer.formatTree(patch);
}

export function format(patch: Patch) {
	return Format.drawTree(formatTree(patch));
}
