import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Logger } from "effect";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";

class DevError extends Data.TaggedError("DevError")<{
	readonly message: string;
}> {}

Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;

	const PaletteGenerator = Effect.gen(function* () {
		const script = path.resolve(import.meta.dir, "generate-palette.ts");
		const cmd = ChildProcess.make("bun", ["run", script], {
			stdout: "inherit",
			stderr: "inherit",
		});
		const Run = Effect.gen(function* () {
			const process = yield* cmd;
			const exit = yield* process.exitCode;
			if (exit !== 0) {
				return yield* new DevError({
					message: `Palette generator exited with ${exit}`,
				});
			}
		});

		yield* Effect.log("Generating initial palette...");
		yield* Run.pipe(Effect.catch(Effect.logFatal));
		yield* Effect.log("Initial palette generated successfully.");

		const paletteFile = path.resolve(
			import.meta.dir,
			"..",
			"src",
			"color",
			"palette.ts",
		);
		const paletteWatcher = fs.watch(paletteFile);
		yield* Stream.runForEach(
			paletteWatcher,
			Effect.fn(function* (event) {
				yield* Effect.log(
					`Palette file changed (${event._tag}), regenerating...`,
				);
				yield* Run;
				yield* Effect.log("Palette regenerated successfully.");
			}, Effect.catch(Effect.logFatal)),
		);
	});

	const DebBuild = Effect.gen(function* () {
		const cmd = ChildProcess.make("vinxi", ["dev"], {
			stderr: "inherit",
			stdout: "inherit",
		});
		const process = yield* cmd;
		const exit = yield* process.exitCode;
		if (exit !== 0) {
			return yield* new DevError({
				message: `Dev server exited with ${exit}`,
			});
		}
	});

	yield* Effect.all([PaletteGenerator, DebBuild], { concurrency: "unbounded" });
}).pipe(
	Effect.catch(Effect.logFatal),
	Effect.provide([Logger.layer([Logger.consolePretty()]), BunServices.layer]),
	Effect.scoped,
	BunRuntime.runMain,
);
