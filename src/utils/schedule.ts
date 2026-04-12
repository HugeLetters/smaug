import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

export namespace Schedule$ {
	export function tap<Out, In, E, R, E2, R2>(
		schedule: Schedule.Schedule<Out, In, E, R>,
		f: (input: In, output: Out) => Effect.Effect<void, E2, R2>,
	) {
		return schedule.pipe(
			Schedule.toStep,
			Effect.map((step) => {
				return (now: number, input: In) => {
					return Effect.tap(step(now, input), ([output]) => f(input, output));
				};
			}),
			Schedule.fromStep,
		);
	}
}
