/**
 * Port of `@effect/vitest` library
 */

import * as BunTest from "bun:test";
import { flow } from "effect";
import type * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fn from "effect/Function";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Num from "effect/Number";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as FastCheck from "effect/testing/FastCheck";
import * as TestClock from "effect/testing/TestClock";
import * as TestConsole from "effect/testing/TestConsole";
import type { EffectGen } from "~/utils/effect";

export namespace EffectBunTest {
	type API = BunTest.Test<[]>;

	export type TestFunction<A, E, R, TestArgs extends Array<unknown>> = (
		...args: TestArgs
	) => Effect.Effect<A, E, R> | EffectGen<Effect.Effect<A, E, R>>;

	export type Test<R> = <A, E>(
		name: string,
		self: TestFunction<A, E, R, []>,
		timeout?: BunTest.TestOptions | number,
	) => void;

	type Arbitrary = Schema.Any | FastCheck.Arbitrary<unknown>;
	type ArbitraryType<TArb extends Arbitrary> =
		TArb extends FastCheck.Arbitrary<infer T> ? T : Schema.Schema.Type<TArb>;

	type Arbitraries = Record<string, Arbitrary>;
	type ArbitrariesType<TArbs extends Arbitraries> = {
		[K in keyof TArbs]: ArbitraryType<TArbs[K]>;
	};

	/**
	 * Effect-based test runner interface for Bun:test.
	 * Provides methods to run Effect computations as tests with various configurations.
	 */
	export interface Tester<R> extends EffectBunTest.Test<R> {
		/** Skip this test */
		skip: EffectBunTest.Test<R>;
		/** Skip test conditionally */
		skipIf: (condition: boolean) => EffectBunTest.Test<R>;
		/** Run test conditionally */
		runIf: (condition: boolean) => EffectBunTest.Test<R>;
		/** Run only this test */
		only: EffectBunTest.Test<R>;
		/** Run test for each case in array */
		each: <T>(
			cases: Arr.NonEmptyArray<T>,
		) => <A, E>(
			name: string,
			self: TestFunction<A, E, R, Array<T>>,
			timeout?: number | BunTest.TestOptions,
		) => void;
		/** Expect test to fail */
		fails: EffectBunTest.Test<R>;

		/** Property-based test with arbitrary data */
		prop: <const TArbs extends Arbitraries, A, E>(
			name: string,
			arbitraries: TArbs,
			self: TestFunction<A, E, R, [ArbitrariesType<TArbs>]>,
			timeout?:
				| number
				| (BunTest.TestOptions & {
						fastCheck?: FastCheck.Parameters<ArbitrariesType<TArbs>>;
				  }),
		) => void;
	}

	export interface MethodsNonLive<R = never> extends API {
		/**
		 * Run Effect-based tests with test services environment.
		 * Provides automatic error handling and test context.
		 */
		readonly effect: EffectBunTest.Tester<TestEnv | R>;
		/**
		 * Retry a test multiple times to handle flaky behavior.
		 */
		readonly flakyTest: <A, E, R2>(
			self: Effect.Effect<A, E, R2>,
			timeout?: Duration.Input,
		) => Effect.Effect<A, never, R2>;
		/**
		 * Run Effect-based tests with scoped resources.
		 */
		readonly scoped: EffectBunTest.Tester<TestEnv | Scope.Scope | R>;
		/**
		 * Share a `Layer` between multiple tests, optionally wrapping
		 * the tests in a `describe` block if a name is provided.
		 *
		 * @example
		 * ```ts
		 * import { Context, Effect, Layer } from "effect"
		 *
		 * class Foo extends Context.Tag("Foo")<Foo, "foo">() {
		 *   static Live = Layer.succeed(Foo, "foo")
		 * }
		 *
		 * class Bar extends Context.Tag("Bar")<Bar, "bar">() {
		 *   static Live = Layer.effect(
		 *     Bar,
		 *     Effect.map(Foo, () => "bar" as const)
		 *   )
		 * }
		 *
		 * test.layer(Foo.Live)("layer", (test) => {
		 *   test.effect("adds context", () =>
		 *     Effect.gen(function* () {
		 *       const foo = yield* Foo
		 *       expect(foo).toEqual("foo")
		 *     })
		 *   )
		 *
		 *   test.layer(Bar.Live)("nested", (test) => {
		 *     test.effect("adds context", () =>
		 *       Effect.gen(function* () {
		 *         const foo = yield* Foo
		 *         const bar = yield* Bar
		 *         expect(foo).toEqual("foo")
		 *         expect(bar).toEqual("bar")
		 *       })
		 *     )
		 *   })
		 * })
		 * ```
		 */
		readonly layer: <R2, E>(
			layer: Layer.Layer<R2, E, R>,
			options?: {
				readonly timeout?: Duration.Input;
			},
		) => (
			name: string,
			f: (test: EffectBunTest.MethodsNonLive<R | R2>) => void,
		) => void;

		readonly prop: <const Arbs extends Arbitraries>(
			name: string,
			arbitraries: Arbs,
			self: (properties: ArbitrariesType<Arbs>) => void,
			timeout?:
				| number
				| (BunTest.TestOptions & {
						fastCheck?: FastCheck.Parameters<ArbitrariesType<Arbs>>;
				  }),
		) => void;
	}

	/**
	 * Full test methods interface including live test runners.
	 */
	export interface Methods<R = never> extends MethodsNonLive<R> {
		/**
		 * Run tests without test environment (integration tests).
		 */
		readonly live: EffectBunTest.Tester<R>;
		/**
		 * Run tests with scoped resources but no test environment.
		 */
		readonly scopedLive: EffectBunTest.Tester<Scope.Scope | R>;
	}
}

function runTestPromise<E, A>(effect: Effect.Effect<A, E>) {
	return Effect.gen(function* () {
		const exit = yield* Effect.exit(effect);
		if (Exit.isSuccess(exit)) {
			return () => exit.value;
		}

		const [mainError, ...restErrors] = Cause.prettyErrors(exit.cause);
		for (const err of restErrors) {
			yield* Effect.logError(err);
		}

		return () => {
			throw mainError;
		};
	})
		.pipe(
			Effect.provide(Logger.layer([Logger.consolePretty()])),
			Effect.runPromise,
		)
		.then((f) => f());
}

const TestEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer());
type TestEnv = Layer.Success<typeof TestEnv>;

function makeTester<R>(
	mapEffect: <A, E>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, never>,
	base = BunTest.test,
) {
	function run<A, E, TestArgs extends Array<unknown>>(
		args: TestArgs,
		self: EffectBunTest.TestFunction<A, E, R, TestArgs>,
	) {
		return Effect.suspend(() => {
			const result = self(...args);
			if (Effect.isEffect(result)) {
				return result;
			}

			return Effect.gen(() => result);
		}).pipe(mapEffect, runTestPromise);
	}

	const test: EffectBunTest.Tester<R> = (name, self, options) => {
		return base(name, () => run([], self), options);
	};

	test.skip = (name, self, timeout) =>
		base.skip(name, () => run([], self), timeout);

	test.skipIf = (condition) => (name, self, timeout) =>
		base.skipIf(condition)(name, () => run([], self), timeout);

	test.runIf = (condition) => (name, self, timeout) =>
		base.if(condition)(name, () => run([], self), timeout);

	test.only = (name, self) => base.only(name, () => run([], self));

	test.each = (cases) => (name, self, timeout) =>
		base.each(cases)(name, (args) => run([args], self), timeout);

	test.fails = (name, self) => base.failing(name, () => run([], self));

	test.prop = (name, arbitraries, self, timeout) => {
		const arbs = FastCheck.record(
			Object.entries(arbitraries).reduce(
				(result, [key, arb]) => {
					const arbitrary =
						arb instanceof FastCheck.Arbitrary ? arb : Schema.toArbitrary(arb);
					result[key] = arbitrary;
					return result;
				},
				{} as Record<string, FastCheck.Arbitrary<unknown>>,
			),
		);

		return base(
			name,
			() => {
				const prop = FastCheck.asyncProperty(arbs, (as) =>
					run([as as never], self).then((v) => !!v),
				);
				return FastCheck.assert(
					prop,
					Predicate.isObject(timeout) ? (timeout?.fastCheck as object) : {},
				);
			},
			timeout,
		);
	};

	return test;
}

const prop: EffectBunTest.Methods["prop"] = (
	name,
	arbitraries,
	self,
	timeout,
) => {
	const arbs = FastCheck.record(
		Object.entries(arbitraries).reduce(
			(result, [key, arb]) => {
				result[key] =
					arb instanceof FastCheck.Arbitrary ? arb : Schema.toArbitrary(arb);
				return result;
			},
			{} as Record<string, FastCheck.Arbitrary<unknown>>,
		),
	);

	return BunTest.test(
		name,
		() => {
			const prop = FastCheck.property(arbs, (as) => self(as as never));
			return FastCheck.assert(
				prop,
				Predicate.isObject(timeout) ? (timeout?.fastCheck as object) : {},
			);
		},
		timeout,
	);
};

function layer<R, E>(
	layer_: Layer.Layer<R, E>,
	options?: {
		readonly memoMap?: Layer.MemoMap;
		readonly timeout?: Duration.Input;
	},
) {
	return (
		name: string,
		fn: (test: EffectBunTest.MethodsNonLive<R>) => void,
	) => {
		const withTestEnv = Layer.provideMerge(layer_, TestEnv);
		const memoMap = options?.memoMap ?? Effect.runSync(Layer.makeMemoMap);
		const scope = Effect.runSync(Scope.make());
		const runtimeEffect = Layer.buildWithMemoMap(
			withTestEnv,
			memoMap,
			scope,
		).pipe(Effect.orDie, Effect.cached, Effect.runSync);

		function makeTest(test: BunTest.Test<[]>): EffectBunTest.MethodsNonLive<R> {
			return Object.assign(test, {
				effect: makeTester<TestEnv | R>(
					(effect) =>
						runtimeEffect.pipe(
							Effect.flatMap((runtime) => effect.pipe(Effect.provide(runtime))),
						),
					test,
				),
				prop,
				scoped: makeTester<TestEnv | Scope.Scope | R>(
					(effect) =>
						runtimeEffect.pipe(
							Effect.flatMap((runtime) =>
								effect.pipe(Effect.scoped, Effect.provide(runtime)),
							),
						),
					test,
				),
				flakyTest,
				layer<R2, E2>(
					nestedLayer: Layer.Layer<R2, E2, R>,
					options?: {
						readonly timeout?: Duration.Input;
					},
				) {
					return layer(Layer.provideMerge(nestedLayer, withTestEnv), {
						...options,
						memoMap,
					});
				},
			});
		}

		BunTest.beforeAll(() => runTestPromise(Effect.asVoid(runtimeEffect)));
		BunTest.afterAll(() => runTestPromise(Scope.close(scope, Exit.void)));
		return BunTest.describe(name, () => {
			return fn(makeTest(BunTest.test));
		});
	};
}

function flakyTest<A, E, R>(
	self: Effect.Effect<A, E, R>,
	timeout: Duration.Input = Duration.seconds(30),
) {
	const timeoutMs = Duration.toMillis(Duration.fromInputUnsafe(timeout));
	return self.pipe(
		Effect.catchDefect(Effect.fail),
		Effect.retry(
			Schedule.recurs(10).pipe(
				Schedule.while((meta) =>
					Num.isLessThanOrEqualTo(meta.elapsed, timeoutMs),
				),
			),
		),
		Effect.orDie,
	);
}

function makeMethods(test: BunTest.Test<[]>): EffectBunTest.Methods {
	return Object.assign(test, {
		effect: makeTester<TestEnv>(flow(Effect.provide(TestEnv)), test),
		scoped: makeTester<TestEnv | Scope.Scope>(
			flow(Effect.scoped, Effect.provide(TestEnv)),
			test,
		),
		live: makeTester<never>(Fn.identity, test),
		scopedLive: makeTester<Scope.Scope>(Effect.scoped, test),
		flakyTest,
		layer,
		prop,
	});
}

/**
 * Main test harness for Effect-based testing with Bun:test.
 * Provides various methods to run Effect computations as tests.
 *
 * @example
 * ```ts
 * import { test, expectEquivalence } from "~/test";
 *
 * test.effect("basic test", () =>
 *   Effect.gen(function* () {
 *     const result = yield* Effect.succeed(42);
 *     expectEquivalence(result, 42);
 *   })
 * );
 *
 * test.scoped("scoped test", () =>
 *   Effect.gen(function* () {
 *     // Test with scoped resources
 *   })
 * );
 *
 * test.live("integration test", () =>
 *   Effect.gen(function* () {
 *     // Test without test environment
 *   })
 * );
 * ```
 */
export const test = makeMethods(BunTest.test);
