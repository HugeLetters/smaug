import * as Arr from "effect/Array";
import * as Chunk from "effect/Chunk";
import * as Data from "effect/Data";
import type * as Differ from "effect/Differ";
import * as HashMap from "effect/HashMap";
import * as HashSet from "effect/HashSet";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import { ArrayDiffer } from "./array.export";
import { ChunkDiffer } from "./chunk.export";
import { Format } from "./format.export";
import { HashMapDiffer } from "./hash-map.export";
import { HashSetDiffer } from "./hash-set.export";
import { MapDiffer } from "./map.export";
import { PlainDiffer } from "./plain.export";
import { RecordDiffer } from "./record.export";
import { SetDiffer } from "./set.export";
import {
	type AndThenPatch,
	combine,
	type EmptyPatch,
	empty,
	makeDiffer,
} from "./shared";
import { StringDiffer } from "./string.export";

class PlainPatch extends Data.TaggedClass("Plain")<{
	readonly patch: PlainDiffer.Patch;
}> {}
class StringPatch extends Data.TaggedClass("String")<{
	readonly patch: StringDiffer.Patch;
}> {}
class ArrayPatch extends Data.TaggedClass("Array")<{
	readonly patch: ArrayDiffer.Patch<unknown, Patch>;
}> {}
class ChunkPatch extends Data.TaggedClass("Chunk")<{
	readonly patch: ChunkDiffer.Patch<unknown, Patch>;
}> {}
class RecordPatch extends Data.TaggedClass("Record")<{
	readonly patch: RecordDiffer.Patch<unknown, Patch>;
}> {}
class HashMapPatch extends Data.TaggedClass("HashMap")<{
	readonly patch: HashMapDiffer.Patch<unknown, unknown, Patch>;
}> {}
class HashSetPatch extends Data.TaggedClass("HashSet")<{
	readonly patch: HashSetDiffer.Patch;
}> {}
class MapPatch extends Data.TaggedClass("Map")<{
	readonly patch: MapDiffer.Patch<unknown, unknown, Patch>;
}> {}
class SetPatch extends Data.TaggedClass("Set")<{
	readonly patch: SetDiffer.Patch;
}> {}

export type Patch =
	| EmptyPatch
	| AndThenPatch<Patch>
	| PlainPatch
	| StringPatch
	| ArrayPatch
	| ChunkPatch
	| RecordPatch
	| HashMapPatch
	| HashSetPatch
	| MapPatch
	| SetPatch;

export const differ: Differ.Differ<unknown, Patch> = makeDiffer<unknown, Patch>(
	{
		empty,
		combine,
		diff(oldValue, newValue) {
			const array = ValueHelpers.array.diff(oldValue, newValue);
			if (array) {
				return array;
			}

			const chunk = ValueHelpers.chunk.diff(oldValue, newValue);
			if (chunk) {
				return chunk;
			}

			const hashMap = ValueHelpers.hashMap.diff(oldValue, newValue);
			if (hashMap) {
				return hashMap;
			}

			const hashSet = ValueHelpers.hashSet.diff(oldValue, newValue);
			if (hashSet) {
				return hashSet;
			}

			const map = ValueHelpers.map.diff(oldValue, newValue);
			if (map) {
				return map;
			}

			const set = ValueHelpers.set.diff(oldValue, newValue);
			if (set) {
				return set;
			}

			const string = ValueHelpers.string.diff(oldValue, newValue);
			if (string) {
				return string;
			}

			const record = ValueHelpers.record.diff(oldValue, newValue);
			if (record) {
				return record;
			}

			return ValueHelpers.plain.diff(oldValue, newValue);
		},
		patch(oldValue, patch) {
			switch (patch._tag) {
				case "Empty":
					return oldValue;
				case "AndThen": {
					const first = differ.patch(oldValue, patch.first);
					return differ.patch(first, patch.second);
				}
				case "Plain":
					return ValueHelpers.plain.patch(oldValue, patch.patch);
				case "String":
					return ValueHelpers.string.patch(oldValue, patch.patch);
				case "Chunk":
					return ValueHelpers.chunk.patch(oldValue, patch.patch);
				case "HashMap":
					return ValueHelpers.hashMap.patch(oldValue, patch.patch);
				case "HashSet":
					return ValueHelpers.hashSet.patch(oldValue, patch.patch);
				case "Array":
					return ValueHelpers.array.patch(oldValue, patch.patch);
				case "Record":
					return ValueHelpers.record.patch(oldValue, patch.patch);
				case "Map":
					return ValueHelpers.map.patch(oldValue, patch.patch);
				case "Set":
					return ValueHelpers.set.patch(oldValue, patch.patch);
			}

			return patch satisfies never;
		},
	},
);

const ValueHelpers = {
	array: makeDifferHelpers(
		Arr.isArray,
		ArrayDiffer.differ(differ),
		(patch) => new ArrayPatch({ patch }),
	),
	chunk: makeDifferHelpers(
		Chunk.isChunk,
		ChunkDiffer.differ(differ),
		(patch) => new ChunkPatch({ patch }),
	),
	hashMap: makeDifferHelpers(
		HashMap.isHashMap,
		HashMapDiffer.differ(differ),
		(patch) => new HashMapPatch({ patch }),
	),
	hashSet: makeDifferHelpers(
		HashSet.isHashSet,
		HashSetDiffer.differ,
		(patch) => new HashSetPatch({ patch }),
	),
	record: makeDifferHelpers(
		Predicate.isReadonlyObject,
		RecordDiffer.differ(differ),
		(patch) => new RecordPatch({ patch }),
	),
	map: makeDifferHelpers(
		Predicate.isMap,
		MapDiffer.differ(differ),
		(patch) => new MapPatch({ patch }),
	),
	set: makeDifferHelpers(
		Predicate.isSet,
		SetDiffer.differ,
		(patch) => new SetPatch({ patch }),
	),
	string: makeDifferHelpers(
		Predicate.isString,
		StringDiffer.differ,
		(patch) => new StringPatch({ patch }),
	),
	plain: {
		differ: PlainDiffer.differ,
		diff: makeDiff(PlainDiffer.differ, (patch) => new PlainPatch({ patch })),
		patch: PlainDiffer.differ.patch,
	},
};

function makeDiff<T, P>(
	differ: Differ.Differ<T, P>,
	makePatch: (patch: P) => Patch,
) {
	return (oldValue: T, newValue: T) => {
		const patch = differ.diff(oldValue, newValue);
		if (patch === differ.empty) {
			return empty;
		}

		return makePatch(patch);
	};
}

function makeDifferHelpers<T, P>(
	predicate: Predicate.Refinement<unknown, T>,
	differ: Differ.Differ<T, P>,
	makePatch: (patch: P) => Patch,
) {
	const diff = makeDiff(differ, makePatch);
	return {
		matcher: predicate,
		diff(oldValue: unknown, newValue: unknown) {
			if (!predicate(oldValue)) {
				return null;
			}

			if (!predicate(newValue)) {
				return null;
			}

			return diff(oldValue, newValue);
		},
		patch(value: unknown, patch: P) {
			if (!predicate(value)) {
				return value;
			}

			return differ.patch(value, patch);
		},
	};
}

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

			Plain: (patch) => PlainDiffer.formatTree(patch.patch),
			String: (patch) => StringDiffer.formatTree(patch.patch),

			Array: (patch) => {
				const tree = ArrayDiffer.formatTree(patch.patch, formatTree);
				return {
					_tag: "Nested",
					label: "Array",
					patch: tree,
				};
			},
			Chunk: (patch) => {
				const tree = ChunkDiffer.formatTree(patch.patch, formatTree);
				return {
					_tag: "Nested",
					label: "Chunk",
					patch: tree,
				};
			},

			HashMap: (patch) => {
				const tree = HashMapDiffer.formatTree(patch.patch, formatTree);
				return {
					_tag: "Nested",
					label: "HashMap",
					patch: tree,
				};
			},
			Map: (patch) => {
				const tree = MapDiffer.formatTree(patch.patch, formatTree);
				return {
					_tag: "Nested",
					label: "Map",
					patch: tree,
				};
			},
			Record: (patch) => {
				const tree = RecordDiffer.formatTree(patch.patch, formatTree);
				return {
					_tag: "Nested",
					label: "Record",
					patch: tree,
				};
			},

			HashSet: (patch) => {
				const tree = HashSetDiffer.formatTree(patch.patch);
				return {
					_tag: "Nested",
					label: "HashSet",
					patch: tree,
				};
			},
			Set: (patch) => {
				const tree = HashSetDiffer.formatTree(patch.patch);
				return {
					_tag: "Nested",
					label: "Set",
					patch: tree,
				};
			},
		}),
	);
}

export function format(patch: Patch) {
	return Format.drawTree(formatTree(patch));
}
