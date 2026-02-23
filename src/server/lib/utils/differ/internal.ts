import type * as EChunk from "effect/Chunk";
import type * as Differ from "effect/Differ";

export namespace BuiltInDiffer {
	export namespace HashMap {
		interface Empty<Key, Value, Patch>
			extends Differ.Differ.HashMap.Patch<Key, Value, Patch> {
			readonly _tag: "Empty";
		}

		interface AndThen<Key, Value, Patch>
			extends Differ.Differ.HashMap.Patch<Key, Value, Patch> {
			readonly _tag: "AndThen";
			readonly first: HashMap.Patch<Key, Value, Patch>;
			readonly second: HashMap.Patch<Key, Value, Patch>;
		}

		interface Add<Key, Value, Patch>
			extends Differ.Differ.HashMap.Patch<Key, Value, Patch> {
			readonly _tag: "Add";
			readonly key: Key;
			readonly value: Value;
		}

		interface Remove<Key, Value, Patch>
			extends Differ.Differ.HashMap.Patch<Key, Value, Patch> {
			readonly _tag: "Remove";
			readonly key: Key;
		}

		interface Update<Key, Value, Patch>
			extends Differ.Differ.HashMap.Patch<Key, Value, Patch> {
			readonly _tag: "Update";
			readonly key: Key;
			readonly patch: Patch;
		}

		export type Patch<Key, Value, Patch> =
			| Empty<Key, Value, Patch>
			| AndThen<Key, Value, Patch>
			| Add<Key, Value, Patch>
			| Remove<Key, Value, Patch>
			| Update<Key, Value, Patch>;
	}

	export namespace Chunk {
		interface Empty<Value, Patch>
			extends Differ.Differ.Chunk.Patch<Value, Patch> {
			readonly _tag: "Empty";
		}

		interface AndThen<Value, Patch>
			extends Differ.Differ.Chunk.Patch<Value, Patch> {
			readonly _tag: "AndThen";
			readonly first: Chunk.Patch<Value, Patch>;
			readonly second: Chunk.Patch<Value, Patch>;
		}

		interface Append<Value, Patch>
			extends Differ.Differ.Chunk.Patch<Value, Patch> {
			readonly _tag: "Append";
			readonly values: EChunk.Chunk<Value>;
		}

		interface Slice<Value, Patch>
			extends Differ.Differ.Chunk.Patch<Value, Patch> {
			readonly _tag: "Slice";
			readonly from: number;
			readonly until: number;
		}

		interface Update<Value, Patch>
			extends Differ.Differ.Chunk.Patch<Value, Patch> {
			readonly _tag: "Update";
			readonly index: number;
			readonly patch: Patch;
		}

		export type Patch<Value, Patch> =
			| Empty<Value, Patch>
			| AndThen<Value, Patch>
			| Append<Value, Patch>
			| Slice<Value, Patch>
			| Update<Value, Patch>;
	}

	export namespace Array {
		interface Empty<Value, Patch>
			extends Differ.Differ.ReadonlyArray.Patch<Value, Patch> {
			readonly _tag: "Empty";
		}

		interface AndThen<Value, Patch>
			extends Differ.Differ.ReadonlyArray.Patch<Value, Patch> {
			readonly _tag: "AndThen";
			readonly first: Array.Patch<Value, Patch>;
			readonly second: Array.Patch<Value, Patch>;
		}

		interface Append<Value, Patch>
			extends Differ.Differ.ReadonlyArray.Patch<Value, Patch> {
			readonly _tag: "Append";
			readonly values: ReadonlyArray<Value>;
		}

		interface Slice<Value, Patch>
			extends Differ.Differ.ReadonlyArray.Patch<Value, Patch> {
			readonly _tag: "Slice";
			readonly from: number;
			readonly until: number;
		}

		interface Update<Value, Patch>
			extends Differ.Differ.ReadonlyArray.Patch<Value, Patch> {
			readonly _tag: "Update";
			readonly index: number;
			readonly patch: Patch;
		}

		export type Patch<Value, Patch> =
			| Empty<Value, Patch>
			| AndThen<Value, Patch>
			| Append<Value, Patch>
			| Slice<Value, Patch>
			| Update<Value, Patch>;
	}

	export namespace HashSet {
		interface Empty<Value> extends Differ.Differ.HashSet.Patch<Value> {
			readonly _tag: "Empty";
		}

		interface AndThen<Value> extends Differ.Differ.HashSet.Patch<Value> {
			readonly _tag: "AndThen";
			readonly first: HashSet.Patch<Value>;
			readonly second: HashSet.Patch<Value>;
		}

		interface Add<Value> extends Differ.Differ.HashSet.Patch<Value> {
			readonly _tag: "Add";
			readonly value: Value;
		}

		interface Remove<Value> extends Differ.Differ.HashSet.Patch<Value> {
			readonly _tag: "Remove";
			readonly value: Value;
		}

		export type Patch<Value> =
			| Empty<Value>
			| AndThen<Value>
			| Add<Value>
			| Remove<Value>;
	}
}
