import * as Chunk from "effect/Chunk";
import type * as Differ from "effect/Differ";
import { ChunkDiffer } from "./chunk.export";
import { Format } from "./format.export";
import { makeDiffer } from "./shared";

export type Patch<TValue, TPatch> = ChunkDiffer.Patch<TValue, TPatch>;

export function differ<TValue, TPatch>(
	valueDiffer: Differ.Differ<TValue, TPatch>,
) {
	const chunkDiffer = ChunkDiffer.differ(valueDiffer);

	return makeDiffer({
		empty: chunkDiffer.empty,
		diff(oldValue: ReadonlyArray<TValue>, newValue) {
			return chunkDiffer.diff(
				Chunk.fromIterable(oldValue),
				Chunk.fromIterable(newValue),
			);
		},
		combine: chunkDiffer.combine,
		patch(oldValue, patch: Patch<TValue, TPatch>) {
			return chunkDiffer
				.patch(Chunk.fromIterable(oldValue), patch)
				.pipe(Chunk.toReadonlyArray);
		},
	});
}

export function formatTree<P>(
	patch: Patch<unknown, P>,
	formatPatchTree: (patch: P) => Format.Tree,
) {
	return ChunkDiffer.formatTree(patch, formatPatchTree);
}

export function format<P>(
	patch: Patch<unknown, P>,
	formatPatchTree: (patch: P) => Format.Tree,
) {
	return Format.drawTree(formatTree(patch, formatPatchTree));
}
