import { expect } from "bun:test";
import { fail } from "node:assert/strict";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Fn from "effect/Function";
import { UnknownDiffer } from "~/server/lib/utils/differ";
import { Stdout } from "~/server/lib/utils/stdout";

/**
 * Asserts that an Effect fails. Flips the result so that success becomes failure and vice versa.
 * Use this to test that Effects fail as expected.
 *
 * @example
 * ```ts
 * test.effect("should fail", () =>
 *   Effect.gen(function* () {
 *     return yield* Effect.fail("expected error");
 *   }).pipe(expectFail)
 * );
 * ```
 */
export function expectFail<E, R>(self: Effect.Effect<unknown, E, R>) {
	return self.pipe(Effect.map(unexpectedSuccess), Effect.flip);
}

const unexpectedSuccess = Fn.flow(
	(v) => Bun.inspect(v, { colors: true, depth: 10 }),
	(v) => `Expected effect to fail. Received\n${v}`,
	(m) => fail(m),
);

/**
 * Asserts that two values are equivalent using Effect's Equal typeclass.
 * Works with Effect Data structures and primitives, but not plain JavaScript objects/arrays.
 * For custom data structures, use Effect's Data module to create comparable types.
 * When values appear structurally equal but fail equality, provides specific guidance via Effect.logWarning.
 * Returns an Effect that should be yielded in test functions.
 *
 * @example
 * ```ts
 * import { Data } from "effect";
 *
 * class Person extends Data.Class<{ name: string; age: number }> {}
 *
 * test.effect("should equal Data structures", () =>
 *   Effect.gen(function* () {
 *     const result = yield* someEffect();
 *     yield* expectEquivalence(result, new Person({ name: "Alice", age: 30 }));
 *   })
 * );
 * ```
 */

export const expectEquivalence = Effect.fn("expectEquivalence", {
	captureStackTrace: true,
})(function* <T>(received: T, expected: T) {
	const patch = UnknownDiffer.differ.diff(expected, received);
	const diff = UnknownDiffer.Formatter.format(patch);

	const areEquivalent = Equal.equals(received, expected);
	const isDiffEmpty = patch === UnknownDiffer.differ.empty;
	if (!areEquivalent && isDiffEmpty) {
		yield* Effect.logWarning(
			"Values appear structurally equal but do not implement Effect's Equal interface.",
			"Consider using Effect's Data module (e.g., Data.Class) for better type safety and performance.",
		);
	}

	const message = `Expected ${Stdout.colored("red", received)} to equal ${Stdout.green(expected)}.\n${diff}`;
	expect(areEquivalent || isDiffEmpty, message).toBeTrue();
});

export { test } from "./bun";
