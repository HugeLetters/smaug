import * as Effect from "effect/Effect";
import * as Fn from "effect/Function";

export type EffectGen<
	TEffect extends Effect.Effect<unknown, unknown, unknown>,
> = Effect.fn.Return<
	Effect.Success<TEffect>,
	Effect.Error<TEffect>,
	Effect.Services<TEffect>
>;

export const flatMapError = Fn.dual<
	<E1, A2, E2, R2>(
		f: (a: E1) => Effect.Effect<A2, E2, R2>,
	) => <A1, R1>(
		self: Effect.Effect<A1, E1, R1>,
	) => Effect.Effect<A1, A2 | E2, R1 | R2>,
	<A1, E1, R1, A2, E2, R2>(
		self: Effect.Effect<A1, E1, R1>,
		f: (a: E1) => Effect.Effect<A2, E2, R2>,
	) => Effect.Effect<A1, A2 | E2, R1 | R2>
>(2, (self, map) => {
	return self.pipe(
		Effect.catch((err) => map(err).pipe(Effect.flatMap(Effect.fail))),
	);
});
