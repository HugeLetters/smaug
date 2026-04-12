import * as Data from "effect/Data";
import type * as Differ from "effect/Differ";

class EmptyPatch extends Data.TaggedClass("Empty") {}

export type { EmptyPatch };
export const empty = new EmptyPatch();

export class AndThenPatch<TPatch> extends Data.TaggedClass("AndThen")<{
	readonly first: TPatch;
	readonly second: TPatch;
}> {}

export function makeDiffer<Value, Patch>(params: Differ.Differ<Value, Patch>) {
	return params;
}

export function combine<T>(first: T | EmptyPatch, second: T | EmptyPatch) {
	if (first === empty) {
		return second;
	}

	if (second === empty) {
		return first;
	}

	return new AndThenPatch({ first, second });
}
