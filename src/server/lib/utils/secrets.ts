import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export class SecretsError extends Data.TaggedError("SecretsError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class Secrets extends Effect.Service<Secrets>()("smaug/Secrets", {
	effect: Effect.fn(function* (domain: string = "finance-app") {
		const service = `smaug/${domain}`;

		const use = Effect.fn("secrets.use")(
			<T>(run: (secrets: typeof Bun.secrets) => T | Promise<T>) =>
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

		function get(key: string) {
			return use((s) => s.get({ service, name: key })).pipe(
				Effect.map((value) => {
					return value === null ? null : Redacted.make(value);
				}),
			);
		}

		return {
			get,
			getOrFail: Effect.fn("getOrFail")(function* (key: string) {
				const value = yield* get(key);
				if (value === null) {
					return yield* new SecretsError({
						message: `Missing secret for ${key} in ${service}`,
					});
				}

				return value;
			}),
			set(key: string, value: string) {
				return use((s) => s.set({ service, name: key, value }));
			},
			delete(key: string) {
				return use((s) => s.delete({ service, name: key }));
			},
		};
	}),
}) {
	static live = Secrets.Default;

	static forKey(key: string) {
		return {
			Get: Effect.flatMap(Secrets, (s) => s.get(key)),
			set(value: string) {
				return Effect.flatMap(Secrets, (s) => s.set(key, value));
			},
			Delete: Effect.flatMap(Secrets, (s) => s.delete(key)),
		};
	}
}
