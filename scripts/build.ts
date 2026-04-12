import { BunRuntime } from "@effect/platform-bun";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Logger } from "effect";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { GeneratePalette } from "../src/color/generate";

class BuildError extends Data.TaggedError("BuildError")<{
	readonly message: string;
}> {}

const LoggerLive = Logger.layer([Logger.consolePretty()]);
const MainLive = Layer.mergeAll(LoggerLive, BunServices.layer);

Effect.gen(function* () {
	yield* Effect.log("Generating palette...");
	yield* GeneratePalette;
	yield* Effect.log("Palette generated successfully.");

	const buildCommand = ChildProcess.make("vinxi", ["build"], {
		stdout: "inherit",
		stderr: "inherit",
	});
	const buildProcess = yield* buildCommand;
	const exit = yield* buildProcess.exitCode;
	if (exit !== 0) {
		return yield* new BuildError({
			message: `Build exited with ${exit}`,
		});
	}
}).pipe(Effect.provide(MainLive), Effect.scoped, BunRuntime.runMain);
