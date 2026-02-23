/**
 * Differ module for computing and applying patches to various data structures.
 *
 * This module provides differencers that can compute differences (patches) between
 * old and new values, and apply those patches to transform values. It supports
 * strings, plain objects, records, maps, sets, and unknown types. Includes a
 * formatter for visualizing patches as hierarchical trees for debugging.
 *
 * The differencers are based on the Effect library's Differ API and use tagged
 * unions for patch types, ensuring type safety and composability.
 */

import { inspect } from "node:util";
import { regex } from "arkregex";
import * as Arr from "effect/Array";
import * as Chunk from "effect/Chunk";
import * as Data from "effect/Data";
import * as Differ from "effect/Differ";
import * as Equal from "effect/Equal";
import { pipe } from "effect/Function";
import * as HashMap from "effect/HashMap";
import * as HashSet from "effect/HashSet";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import type { BuiltInDiffer } from "./internal";

/**
 * Differ for string values, supporting efficient string transformation operations.
 *
 * Computes patches for appended, prepended, or replaced strings, optimizing for
 * common text editing scenarios like appending or prepending text.
 */
namespace StringDiffer {
	class EmptyPatch extends Data.TaggedClass("Empty") {}
	class AndThenPatch extends Data.TaggedClass("AndThen")<{
		readonly first: Patch;
		readonly second: Patch;
	}> {}
	class ReplacePatch extends Data.TaggedClass("Replace")<{
		readonly from: Value;
		readonly to: Value;
	}> {}

	class AppendedPatch extends Data.TaggedClass("Appended")<{
		readonly appended: Value;
	}> {}
	class UnappendedPatch extends Data.TaggedClass("Unappended")<{
		readonly unappended: Value;
	}> {}
	class PrependedPatch extends Data.TaggedClass("Prepended")<{
		readonly preprended: Value;
	}> {}
	class UnprependedPatch extends Data.TaggedClass("Unprepended")<{
		readonly unpreprended: Value;
	}> {}

	export type Patch =
		| EmptyPatch
		| AndThenPatch
		| ReplacePatch
		| AppendedPatch
		| UnappendedPatch
		| PrependedPatch
		| UnprependedPatch;

	export type Value = string;

	/**
	 * String differencer implementing the Differ API.
	 */
	export const differ = Differ.make<Value, Patch>({
		combine(first, second) {
			if (first._tag === "Empty") {
				return second;
			}

			if (second._tag === "Empty") {
				return first;
			}

			return new AndThenPatch({ first, second });
		},
		/**
		 * Computes the difference between old and new string values.
		 * Returns specialized patches for append/prepend operations when possible.
		 */
		diff(oldValue, newValue): Patch {
			if (oldValue === newValue) {
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
					preprended: newValue.slice(0, -oldValue.length),
				});
			}

			if (oldValue.endsWith(newValue)) {
				return new UnprependedPatch({
					unpreprended: oldValue.slice(0, -newValue.length),
				});
			}

			return new ReplacePatch({ from: oldValue, to: newValue });
		},
		empty: new EmptyPatch(),
		patch(patch, oldValue): Value {
			return Match.value(patch).pipe(
				Match.withReturnType<Value>(),
				Match.tagsExhaustive({
					Empty() {
						return oldValue;
					},
					AndThen(patch) {
						const first = differ.patch(patch.first, oldValue);
						return differ.patch(patch.second, first);
					},
					Replace(patch) {
						return patch.to;
					},
					Appended(patch) {
						return `${oldValue}${patch.appended}`;
					},
					Prepended(patch) {
						return `${patch.preprended}${oldValue}`;
					},
					Unappended(patch) {
						return oldValue.slice(0, -patch.unappended.length);
					},
					Unprepended(patch) {
						return oldValue.slice(patch.unpreprended.length);
					},
				}),
			);
		},
	});
}

/**
 * Differ for plain unknown values, falling back to string differ for strings.
 *
 * Handles basic equality checks and delegates string-specific operations to StringDiffer.
 */
namespace PlainDiffer {
	class EmptyPatch extends Data.TaggedClass("Empty") {}
	class AndThenPatch extends Data.TaggedClass("AndThen")<{
		readonly first: Patch;
		readonly second: Patch;
	}> {}
	class ReplacePatch extends Data.TaggedClass("Replace")<{
		readonly from: Value;
		readonly to: Value;
	}> {}
	class StringPatch extends Data.TaggedClass("StringPatch")<{
		readonly patch: StringDiffer.Patch;
	}> {}

	export type Patch = EmptyPatch | AndThenPatch | ReplacePatch | StringPatch;

	export type Value = unknown;

	/**
	 * Plain differencer for unknown values.
	 */
	export const differ = Differ.make<Value, Patch>({
		combine(first, second) {
			if (first._tag === "Empty") {
				return second;
			}

			if (second._tag === "Empty") {
				return first;
			}

			return new AndThenPatch({ first, second });
		},
		diff(oldValue, newValue): Patch {
			if (Equal.equals(oldValue, newValue)) {
				return differ.empty;
			}

			if (Predicate.isString(oldValue) && Predicate.isString(newValue)) {
				return new StringPatch({
					patch: StringDiffer.differ.diff(oldValue, newValue),
				});
			}

			return new ReplacePatch({ from: oldValue, to: newValue });
		},
		empty: new EmptyPatch(),
		patch(patch, oldValue): Value {
			return Match.value(patch).pipe(
				Match.withReturnType<Value>(),
				Match.tagsExhaustive({
					Empty() {
						return oldValue;
					},
					AndThen(patch) {
						const first = differ.patch(patch.first, oldValue);
						return differ.patch(patch.second, first);
					},
					Replace(patch) {
						return patch.to;
					},
					StringPatch(patch) {
						if (!Predicate.isString(oldValue)) {
							return oldValue;
						}

						return StringDiffer.differ.patch(patch.patch, oldValue);
					},
				}),
			);
		},
	});
}

/**
 * Differ for record (object) structures using HashMap internally.
 *
 * Computes patches for record changes like adding, removing, or updating properties.
 */
namespace RecordDiffer {
	export type Patch<Value, Patch> = BuiltInDiffer.HashMap.Patch<
		string,
		Value,
		Patch
	>;

	export type Value<TValue = unknown> = Record.ReadonlyRecord<string, TValue>;

	export function make<Value, Patch>(differ: Differ.Differ<Value, Patch>) {
		const hmDiffer = Differ.hashMap<string, Value, Patch>(differ);

		return Differ.make({
			empty: hmDiffer.empty,
			diff: (oldValue: RecordDiffer.Value<Value>, newValue) => {
				const oldHm = HashMap.fromIterable(Object.entries(oldValue));
				const newHm = HashMap.fromIterable(Object.entries(newValue));
				return hmDiffer.diff(oldHm, newHm);
			},
			combine: hmDiffer.combine,
			patch: (patch, oldValue) => {
				const oldHm = HashMap.fromIterable(Object.entries(oldValue));
				const patched = hmDiffer.patch(patch, oldHm);
				return Data.struct(Record.fromEntries(patched));
			},
		});
	}
}

/**
 * Differ for Map structures.
 *
 * Computes patches for map changes like adding, removing, or updating key-value pairs.
 */
namespace MapDiffer {
	export type Patch<Key, Value, Patch> = BuiltInDiffer.HashMap.Patch<
		Key,
		Value,
		Patch
	>;

	export type Value<K, V> = ReadonlyMap<K, V>;

	export function make<Key, Value, Patch>(differ: Differ.Differ<Value, Patch>) {
		const hmDiffer = Differ.hashMap<Key, Value, Patch>(differ);

		return Differ.make({
			empty: hmDiffer.empty,
			diff: (oldValue: MapDiffer.Value<Key, Value>, newValue) => {
				const oldHm = HashMap.fromIterable(oldValue);
				const newHm = HashMap.fromIterable(newValue);
				return hmDiffer.diff(oldHm, newHm);
			},
			combine: hmDiffer.combine,
			patch: (patch, oldValue) => {
				const oldHm = HashMap.fromIterable(oldValue);
				const patched = hmDiffer.patch(patch, oldHm);
				return new Map(patched);
			},
		});
	}
}

/**
 * Differ for Set structures.
 *
 * Computes patches for set changes like adding or removing elements.
 */
namespace SetDiffer {
	export type Patch<Value> = BuiltInDiffer.HashSet.Patch<Value>;

	export type Value<V> = ReadonlySet<V>;

	export const make = <Value>() => {
		const hsDiffer = Differ.hashSet<Value>();

		return Differ.make({
			empty: hsDiffer.empty,
			diff: (oldValue: SetDiffer.Value<Value>, newValue) => {
				const oldHs = HashSet.fromIterable(oldValue);
				const newHs = HashSet.fromIterable(newValue);
				return hsDiffer.diff(oldHs, newHs);
			},
			combine: hsDiffer.combine,
			patch: (patch, oldValue) => {
				const oldHs = HashSet.fromIterable(oldValue);
				const patched = hsDiffer.patch(patch, oldHs);
				return new Set(patched);
			},
		});
	};
}

/**
 * Universal differ for unknown values, dispatching to appropriate differencers based on type.
 *
 * Supports arrays, chunks, records, hashmaps, hashsets, maps, sets, and plain values.
 * Provides a Formatter namespace for visualizing patches as tree structures.
 */
export namespace UnknownDiffer {
	class EmptyPatch extends Data.TaggedClass("Empty") {}
	class AndThen extends Data.TaggedClass("AndThen")<{
		readonly first: Patch;
		readonly second: Patch;
	}> {}

	class PlainPatch extends Data.TaggedClass("Plain")<{
		readonly patch: PlainDiffer.Patch;
	}> {}
	class ArrayPatch extends Data.TaggedClass("Array")<{
		readonly patch: BuiltInDiffer.Array.Patch<unknown, Patch>;
	}> {}
	class ChunkPatch extends Data.TaggedClass("Chunk")<{
		readonly patch: BuiltInDiffer.Chunk.Patch<unknown, Patch>;
	}> {}
	class RecordPatch extends Data.TaggedClass("Record")<{
		readonly patch: RecordDiffer.Patch<unknown, Patch>;
	}> {}
	class HashMapPatch extends Data.TaggedClass("HashMap")<{
		readonly patch: BuiltInDiffer.HashMap.Patch<unknown, unknown, Patch>;
	}> {}
	class HashSetPatch extends Data.TaggedClass("HashSet")<{
		readonly patch: BuiltInDiffer.HashSet.Patch<unknown>;
	}> {}
	class MapPatch extends Data.TaggedClass("Map")<{
		readonly patch: MapDiffer.Patch<unknown, unknown, Patch>;
	}> {}
	class SetPatch extends Data.TaggedClass("Set")<{
		readonly patch: SetDiffer.Patch<unknown>;
	}> {}

	export type Patch =
		| EmptyPatch
		| AndThen
		| PlainPatch
		| ArrayPatch
		| ChunkPatch
		| RecordPatch
		| HashMapPatch
		| HashSetPatch
		| MapPatch
		| SetPatch;

	export type Value = unknown;

	function pair<V>(predicate: V) {
		return [predicate, predicate] as const;
	}

	/**
	 * Universal differencer that dispatches to specialized differencers based on value type.
	 */
	export const differ = Differ.make<Value, Patch>({
		empty: new EmptyPatch(),

		diff(oldValue, newValue): Patch {
			return Match.value([oldValue, newValue]).pipe(
				Match.when(pair(ValueHelpers.chunk.matcher), ([oldValue, newValue]) => {
					const patch = ValueHelpers.chunk.differ.diff(
						oldValue,
						newValue,
					) as ChunkPatch["patch"];

					if (patch._tag === "Empty") {
						return differ.empty;
					}

					return new ChunkPatch({ patch });
				}),
				Match.when(
					pair(ValueHelpers.hashMap.matcher),
					([oldValue, newValue]) => {
						const patch = ValueHelpers.hashMap.differ.diff(
							oldValue,
							newValue,
						) as HashMapPatch["patch"];

						if (patch._tag === "Empty") {
							return differ.empty;
						}

						return new HashMapPatch({ patch });
					},
				),
				Match.when(
					pair(ValueHelpers.hashSet.matcher),
					([oldValue, newValue]) => {
						const patch = ValueHelpers.hashSet.differ.diff(
							oldValue,
							newValue,
						) as HashSetPatch["patch"];

						if (patch._tag === "Empty") {
							return differ.empty;
						}

						return new HashSetPatch({ patch });
					},
				),
				Match.when(pair(ValueHelpers.array.matcher), ([oldValue, newValue]) => {
					const patch = ValueHelpers.array.differ.diff(
						oldValue,
						newValue,
					) as ArrayPatch["patch"];

					if (patch._tag === "Empty") {
						return differ.empty;
					}

					return new ArrayPatch({ patch });
				}),
				Match.when(pair(ValueHelpers.map.matcher), ([oldValue, newValue]) => {
					const patch = ValueHelpers.map.differ.diff(
						oldValue,
						newValue,
					) as MapPatch["patch"];

					if (patch._tag === "Empty") {
						return differ.empty;
					}

					return new MapPatch({ patch });
				}),
				Match.when(pair(ValueHelpers.set.matcher), ([oldValue, newValue]) => {
					const patch = ValueHelpers.set.differ.diff(
						oldValue,
						newValue,
					) as SetPatch["patch"];

					if (patch._tag === "Empty") {
						return differ.empty;
					}

					return new SetPatch({ patch });
				}),
				Match.when(
					pair(ValueHelpers.record.matcher),
					([oldValue, newValue]) => {
						const patch = ValueHelpers.record.differ.diff(
							oldValue,
							newValue,
						) as RecordPatch["patch"];

						if (patch._tag === "Empty") {
							return differ.empty;
						}

						return new RecordPatch({ patch });
					},
				),
				Match.orElse(([oldValue, newValue]) => {
					const patch = ValueHelpers.plain.differ.diff(oldValue, newValue);
					if (patch._tag === "Empty") {
						return differ.empty;
					}

					return new PlainPatch({ patch });
				}),
			);
		},

		combine(first, second) {
			if (first._tag === "Empty") {
				return second;
			}

			if (second._tag === "Empty") {
				return first;
			}

			return new AndThen({ first, second });
		},

		patch(patch, oldValue): Value {
			return Match.value(patch).pipe(
				Match.withReturnType<Value>(),
				Match.tagsExhaustive({
					Empty() {
						return oldValue;
					},
					AndThen(patch) {
						const first = differ.patch(patch.first, oldValue);
						return differ.patch(patch.second, first);
					},
					Plain(patch) {
						return ValueHelpers.plain.differ.patch(patch.patch, oldValue);
					},
					Chunk(patch) {
						if (!ValueHelpers.chunk.matcher(oldValue)) {
							return oldValue;
						}

						return ValueHelpers.chunk.differ.patch(patch.patch, oldValue);
					},
					HashMap(patch) {
						if (!ValueHelpers.hashMap.matcher(oldValue)) {
							return oldValue;
						}

						return ValueHelpers.hashMap.differ.patch(patch.patch, oldValue);
					},
					HashSet(patch) {
						if (!ValueHelpers.hashSet.matcher(oldValue)) {
							return oldValue;
						}

						return ValueHelpers.hashSet.differ.patch(patch.patch, oldValue);
					},
					Array(patch) {
						if (!ValueHelpers.array.matcher(oldValue)) {
							return oldValue;
						}

						return ValueHelpers.array.differ.patch(patch.patch, oldValue);
					},
					Record(patch) {
						if (!ValueHelpers.record.matcher(oldValue)) {
							return oldValue;
						}

						return ValueHelpers.record.differ.patch(patch.patch, oldValue);
					},
					Map(patch) {
						if (!ValueHelpers.map.matcher(oldValue)) {
							return oldValue;
						}

						return ValueHelpers.map.differ.patch(patch.patch, oldValue);
					},
					Set(patch) {
						if (!ValueHelpers.set.matcher(oldValue)) {
							return oldValue;
						}

						return ValueHelpers.set.differ.patch(patch.patch, oldValue);
					},
				}),
			);
		},
	});

	const ValueHelpers = {
		array: {
			matcher: (v: unknown) => Arr.isArray(v),
			differ: Differ.readonlyArray(differ),
		},
		chunk: {
			matcher: Chunk.isChunk,
			differ: Differ.chunk(differ),
		},
		hashMap: {
			matcher: HashMap.isHashMap,
			differ: Differ.hashMap(differ),
		},
		hashSet: {
			matcher: HashSet.isHashSet,
			differ: Differ.hashSet(),
		},
		record: {
			matcher: Predicate.isReadonlyRecord,
			differ: RecordDiffer.make(differ),
		},
		map: {
			matcher: Predicate.isMap,
			differ: MapDiffer.make(differ),
		},
		set: {
			matcher: Predicate.isSet,
			differ: SetDiffer.make(),
		},
		plain: {
			differ: PlainDiffer.differ,
		},
	};

	/**
	 * Formatter for visualizing patches as hierarchical tree structures.
	 *
	 * Converts patch objects into human-readable tree representations for debugging
	 * and understanding complex diffs.
	 */
	export namespace Formatter {
		export function format(patch: Patch): string {
			const tree = makeUnknownTree(patch);
			return drawTree(tree);
		}

		interface EmptyPatch {
			readonly _tag: "Empty";
		}

		interface NestedPatch {
			readonly _tag: "Nested";
			readonly label: string;
			readonly patch: PatchTree;
		}

		interface SequencePatch {
			readonly _tag: "Sequence";
			readonly patch: Chunk.Chunk<PatchTree>;
		}

		interface UnitPatch {
			readonly _tag: "Unit";
			readonly content: string;
		}

		type PatchTree = EmptyPatch | UnitPatch | NestedPatch | SequencePatch;

		const empty: PatchTree = { _tag: "Empty" };

		const ItemPrefix = "├──";
		const LastPrefix = "└──";
		const LinePrefix = "│  ";
		const AfterLastPrefix = "   ";
		interface TreeMeta {
			prefix: {
				item: string;
				line: string;
				last: string;
				afterLast: string;
			};
		}
		function drawTree(
			tree: PatchTree,
			meta: TreeMeta = {
				prefix: {
					item: "",
					last: "",
					line: "",
					afterLast: "",
				},
			},
		): string {
			const { prefix } = meta;
			return Match.value(tree).pipe(
				Match.tagsExhaustive({
					Empty() {
						return `${prefix.last}<unchanged>`;
					},
					Unit(tree) {
						return `${prefix.last}${tree.content}`;
					},
					Sequence(tree) {
						const nonEmptyPatches = tree.patch.pipe(
							flattenSequence,
							Chunk.filter((tree) => tree._tag !== "Empty"),
						);

						if (Chunk.isEmpty(nonEmptyPatches)) {
							return `${prefix.last}${drawTree(empty)}`;
						}

						return nonEmptyPatches.pipe(
							Chunk.map((tree, i) => {
								const isLast = i === nonEmptyPatches.length - 1;
								return `${drawTree(tree, {
									prefix: {
										...prefix,
										line: isLast
											? prefix.line
											: prefix.line.replace(
													regex(`${AfterLastPrefix}$`),
													LinePrefix,
												),
										last: isLast ? prefix.last : prefix.item,
									},
								})}`;
							}),
							Chunk.join("\n"),
						);
					},
					Nested(tree) {
						const patch = drawTree(tree.patch, {
							prefix: {
								item: `${prefix.line}${ItemPrefix}`,
								line: `${prefix.line}${AfterLastPrefix}`,
								last: `${prefix.line}${LastPrefix}`,
								afterLast: `${prefix.line}${AfterLastPrefix}`,
							},
						});
						return `${prefix.last}${tree.label}\n${patch}`;
					},
				}),
			);
		}

		function flattenSequence(
			patches: Chunk.Chunk<PatchTree>,
		): Chunk.Chunk<Exclude<PatchTree, SequencePatch>> {
			return Chunk.flatMap(patches, (tree) => {
				if (tree._tag !== "Sequence") {
					return Chunk.of(tree);
				}

				return flattenSequence(tree.patch);
			});
		}

		function makeUnknownTree(patch: Patch): PatchTree {
			return Match.value(patch).pipe(
				Match.withReturnType<PatchTree>(),
				Match.tagsExhaustive({
					Empty: () => empty,
					AndThen: (patch) => {
						const first = makeUnknownTree(patch.first);
						const second = makeUnknownTree(patch.second);
						return {
							_tag: "Sequence",
							patch: Chunk.make(first, second),
						};
					},
					Plain: (patch) => makePlainTree(patch.patch),
					Array: (patch) => {
						const tree = makeArrayTree(patch.patch);
						return {
							_tag: "Nested",
							label: "Array",
							patch: tree,
						};
					},
					Chunk: (patch) => {
						const tree = makeChunkTree(patch.patch);
						return {
							_tag: "Nested",
							label: "Chunk",
							patch: tree,
						};
					},
					Record: (patch) => {
						const tree = makeRecordTree(patch.patch);
						return {
							_tag: "Nested",
							label: "Record",
							patch: tree,
						};
					},
					HashMap: (patch) => {
						const tree = makeHashMapTree(patch.patch);
						return {
							_tag: "Nested",
							label: "HashMap",
							patch: tree,
						};
					},
					HashSet: (patch) => {
						const tree = makeHashSetTree(patch.patch);
						return {
							_tag: "Nested",
							label: "HashSet",
							patch: tree,
						};
					},
					Map: (patch) => {
						const tree = makeMapTree(patch.patch);
						return {
							_tag: "Nested",
							label: "Map",
							patch: tree,
						};
					},
					Set: (patch) => {
						const tree = makeSetTree(patch.patch);
						return {
							_tag: "Nested",
							label: "Set",
							patch: tree,
						};
					},
				}),
			);
		}

		function makePlainTree(patch: PlainPatch["patch"]): PatchTree {
			return Match.value(patch).pipe(
				Match.withReturnType<PatchTree>(),
				Match.tagsExhaustive({
					Empty() {
						return empty;
					},
					AndThen(patch) {
						const first = makePlainTree(patch.first);
						const second = makePlainTree(patch.second);
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
					StringPatch(patch) {
						return {
							_tag: "Nested",
							label: "String",
							patch: makeStringTree(patch.patch),
						};
					},
				}),
			);
		}

		function makeStringTree(patch: StringDiffer.Patch): PatchTree {
			return Match.value(patch).pipe(
				Match.withReturnType<PatchTree>(),
				Match.tagsExhaustive({
					Empty: () => empty,
					AndThen: (patch) => {
						const first = makeStringTree(patch.first);
						const second = makeStringTree(patch.second);
						return {
							_tag: "Sequence",
							patch: Chunk.make(first, second),
						};
					},
					Replace: (patch) => ({
						_tag: "Unit",
						content: `Replace: ${formatValue(patch.from)} ~> ${formatValue(patch.to)}`,
					}),
					Appended: (patch) => ({
						_tag: "Unit",
						content: `Appended: ${formatValue(patch.appended)}`,
					}),
					Unappended: (patch) => ({
						_tag: "Unit",
						content: `Unappended: ${formatValue(patch.unappended)}`,
					}),
					Prepended: (patch) => ({
						_tag: "Unit",
						content: `Prepended: ${formatValue(patch.preprended)}`,
					}),
					Unprepended: (patch) => ({
						_tag: "Unit",
						content: `Unprepended: ${formatValue(patch.unpreprended)}`,
					}),
				}),
			);
		}

		function makeArrayTree(patch: ArrayPatch["patch"]): PatchTree {
			return Match.value(patch).pipe(
				Match.withReturnType<PatchTree>(),
				Match.tagsExhaustive({
					Empty: () => empty,
					AndThen: (patch) => {
						const first = makeArrayTree(patch.first);
						const second = makeArrayTree(patch.second);
						return {
							_tag: "Sequence",
							patch: Chunk.make(first, second),
						};
					},
					Append: (patch) => ({
						_tag: "Sequence",
						patch: pipe(
							patch.values,
							Chunk.fromIterable,
							Chunk.map((value) => ({
								_tag: "Unit",
								content: `Append: ${formatValue(value)}`,
							})),
						),
					}),
					Slice: (patch) => ({
						_tag: "Unit",
						content: `Slice: ${formatValue(patch.from)} - ${formatValue(patch.until)}`,
					}),
					Update: (patch) => {
						const tree = makeUnknownTree(patch.patch);
						return {
							_tag: "Nested",
							label: `Update: ${formatValue(patch.index)}`,
							patch: tree,
						};
					},
				}),
			);
		}

		function makeChunkTree(patch: ChunkPatch["patch"]): PatchTree {
			return Match.value(patch).pipe(
				Match.withReturnType<PatchTree>(),
				Match.tagsExhaustive({
					Empty: () => empty,
					AndThen: (patch) => {
						const first = makeChunkTree(patch.first);
						const second = makeChunkTree(patch.second);
						return {
							_tag: "Sequence",
							patch: Chunk.make(first, second),
						};
					},
					Append: (patch) => ({
						_tag: "Sequence",
						patch: Chunk.map(patch.values, (value) => ({
							_tag: "Unit",
							content: `Append: ${formatValue(value)}`,
						})),
					}),
					Slice: (patch) => ({
						_tag: "Unit",
						content: `Slice: ${formatValue(patch.from)} - ${formatValue(patch.until)}`,
					}),
					Update: (patch) => {
						const tree = makeUnknownTree(patch.patch);
						return {
							_tag: "Nested",
							label: `Update: ${formatValue(patch.index)}`,
							patch: tree,
						};
					},
				}),
			);
		}

		function makeRecordTree(patch: RecordPatch["patch"]): PatchTree {
			return Match.value(patch).pipe(
				Match.withReturnType<PatchTree>(),
				Match.tagsExhaustive({
					Empty: () => empty,
					AndThen: (patch) => {
						const first = makeRecordTree(patch.first);
						const second = makeRecordTree(patch.second);
						return {
							_tag: "Sequence",
							patch: Chunk.make(first, second),
						};
					},
					Remove: (patch) => ({
						_tag: "Unit",
						content: `Remove: ${formatValue(patch.key)}`,
					}),
					Add: (patch) => ({
						_tag: "Unit",
						content: `Add: ${formatValue(patch.key)} ~> ${formatValue(patch.value)}`,
					}),
					Update: (patch) => {
						const tree = makeUnknownTree(patch.patch);
						return {
							_tag: "Nested",
							label: `Update: ${formatValue(patch.key)}`,
							patch: tree,
						};
					},
				}),
			);
		}

		function makeHashMapTree(patch: HashMapPatch["patch"]): PatchTree {
			return Match.value(patch).pipe(
				Match.withReturnType<PatchTree>(),
				Match.tagsExhaustive({
					Empty: () => empty,
					AndThen: (patch) => {
						const first = makeHashMapTree(patch.first);
						const second = makeHashMapTree(patch.second);
						return {
							_tag: "Sequence",
							patch: Chunk.make(first, second),
						};
					},
					Remove: (patch) => ({
						_tag: "Unit",
						content: `Remove: ${formatValue(patch.key)}`,
					}),
					Add: (patch) => ({
						_tag: "Unit",
						content: `Add: ${formatValue(patch.key)} ~> ${formatValue(patch.value)}`,
					}),
					Update: (patch) => {
						const tree = makeUnknownTree(patch.patch);
						return {
							_tag: "Nested",
							label: `Update: ${formatValue(patch.key)}`,
							patch: tree,
						};
					},
				}),
			);
		}

		function makeHashSetTree(patch: HashSetPatch["patch"]): PatchTree {
			return Match.value(patch).pipe(
				Match.withReturnType<PatchTree>(),
				Match.tagsExhaustive({
					Empty: () => empty,
					AndThen: (patch) => {
						const first = makeHashSetTree(patch.first);
						const second = makeHashSetTree(patch.second);
						return {
							_tag: "Sequence",
							patch: Chunk.make(first, second),
						};
					},
					Add: (patch) => ({
						_tag: "Unit",
						content: `Add: ${formatValue(patch.value)}`,
					}),
					Remove: (patch) => ({
						_tag: "Unit",
						content: `Remove: ${formatValue(patch.value)}`,
					}),
				}),
			);
		}

		function makeMapTree(patch: MapPatch["patch"]): PatchTree {
			return makeHashMapTree(patch);
		}

		function makeSetTree(patch: SetPatch["patch"]): PatchTree {
			return makeHashSetTree(patch);
		}

		function formatValue(value: unknown) {
			return inspect(value, {
				compact: true,
				colors: true,
				depth: 0,
				maxArrayLength: 0,
				maxStringLength: 10,
				breakLength: Number.POSITIVE_INFINITY,
			});
		}
	}
}
