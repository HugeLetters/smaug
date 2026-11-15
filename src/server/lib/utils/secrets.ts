/**
 * macOS Keychain access through `Bun.secrets`, scoped to one Keychain service. Bun only.
 *
 * ```ts
 * Secrets.forKey("api-token").GetOrFail.pipe(Effect.provide(Secrets.layer("my-app")));
 * ```
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Function_ from "effect/Function";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

export class SecretsError extends Data.TaggedError("SecretsError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class Secrets extends Context.Service<Secrets>()("smaug/Secrets", {
	make: Effect.fn(function* (service: string) {
		const use = Effect.fn("secrets.use")(
			<T>(run: (secrets: typeof Bun.secrets) => T | PromiseLike<T>) =>
				Effect.tryPromise({
					async try() {
						return run(Bun.secrets);
					},
					catch(error) {
						return new SecretsError({
							message: "Bun.secrets call failed",
							cause: error,
						});
					},
				}),
		);

		/** The secret, or `null` when it isn't stored. */
		function get(name: string) {
			return use((s) => s.get({ service, name })).pipe(
				Effect.map((value) => (value === null ? null : Redacted.make(value))),
			);
		}

		return {
			service,
			get,
			getOrFail: Effect.fn("secrets.getOrFail")(function* (name: string) {
				const value = yield* get(name);
				if (value === null) {
					return yield* new SecretsError({
						message: `Missing secret ${name} in ${service}`,
					});
				}
				return value;
			}),
			set(name: string, value: Redacted.Redacted<string>) {
				return use((s) =>
					s.set({ service, name, value: Redacted.value(value) }),
				);
			},
			delete(name: string) {
				return use((s) => s.delete({ service, name }));
			},
		};
	}),
}) {
	/** Secrets stored under the given Keychain service name. */
	static layer = Function_.flow(Secrets.make, Layer.effect(Secrets));

	/** Accessors bound to one secret name. */
	static forKey(name: string) {
		return {
			Get: Secrets.use((s) => s.get(name)),
			GetOrFail: Secrets.use((s) => s.getOrFail(name)),
			set(value: Redacted.Redacted<string>) {
				return Secrets.use((s) => s.set(name, value));
			},
			Delete: Secrets.use((s) => s.delete(name)),
		};
	}
}
