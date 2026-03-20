/**
 * Runs a Ralph Wiggum loop for LLM CLIs.
 * Repeats the same prompt until a completion promise appears.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Logger } from "effect";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import * as Argument from "effect/unstable/cli/Argument";
import * as CliError from "effect/unstable/cli/CliError";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as ChildProcess from "effect/unstable/process/ChildProcess";

type RalphConfig = Command.Command.Config.Infer<typeof CliConfig>;

export enum Models {
	Gpt5_2_Codex = "openai/gpt-5.2-codex",
	KimiK2_5 = "opencode/kimi-k2.5-free",
	TrinityLarge = "opencode/trinity-large-preview-free",
}

const runIteration = Effect.fn("runIteration")(function* (config: RalphConfig) {
	const fullPrompt = [...config.prompts, ...config.filePrompts].join("\n");
	if (!fullPrompt) {
		return yield* new CliError.UserError({ cause: "Missing prompt" });
	}

	const prompt =
		`${fullPrompt}\n` +
		`After completing each task, append to ${config.progressFile}\n` +
		`If, while implementing the feature, you notice that all work is complete, output ${config.completionPromise}`;

	const command = ChildProcess.make(
		"opencode",
		["run", "-m", config.model, ...config.commandArgs],
		{ stdin: Stream.succeed(Buffer.from(prompt)) },
	);

	const process = yield* command;
	const decoder = new TextDecoder("utf-8");

	const outputStream = process.stdout.pipe(
		Stream.map((chunk) => decoder.decode(chunk, { stream: true })),
	);

	yield* process.stderr.pipe(
		Stream.map((chunk) => decoder.decode(chunk, { stream: true })),
		Stream.runForEach((text) => Effect.logInfo(text)),
		Effect.forkScoped,
	);

	return yield* outputStream.pipe(
		Stream.tap((text) => Effect.log(text)),
		Stream.runFold(
			() => "",
			(out, chunk) => `${out}${chunk}`,
		),
		Effect.tap(() => {
			const flush = decoder.decode();
			if (flush) {
				return Effect.log(flush);
			}

			return Effect.void;
		}),
	);
}, Effect.scoped);

export const runRalphLoop = Effect.fn("runRalphLoop")(function* (
	config: RalphConfig,
) {
	const maxIterations = yield* getMaxIterations(config);
	let iteration = 1;
	while (maxIterations === null || iteration <= maxIterations) {
		yield* Effect.log(`Ralph loop iteration ${iteration}...`);
		const output = yield* runIteration(config);
		if (output.includes(config.completionPromise)) {
			yield* Effect.log("Completion promise detected. Loop finished.");
			return;
		}
		iteration += 1;
	}

	yield* Effect.log(
		`Max iterations reached (${maxIterations}). Stopping loop.`,
	);
});

const prompts = Flag.string("prompt").pipe(
	Flag.withDescription("Prompt text to send to the CLI"),
	Flag.atLeast(0),
);

const filePrompts = Flag.fileText("prompt-file").pipe(
	Flag.withDescription("File path to read additional prompt text"),
	Flag.atLeast(0),
);

const completionPromise = Flag.string("completion-promise").pipe(
	Flag.withDescription("Token that ends the loop when seen in output"),
	Flag.withDefault("DONE"),
	Flag.filterMap(
		Option.liftPredicate(Str.isNonEmpty),
		() => "completion-promise cannot be empty",
	),
	Flag.map((promise) => `<promise>${promise}</promise>`),
);

const progressFile = Flag.string("progress-file").pipe(
	Flag.withDescription(
		"File path to append streamed output for progress tracking",
	),
	Flag.withDefault("progress.txt"),
);

const maxIterations = Flag.integer("max-iterations").pipe(
	Flag.withDescription("Maximum iterations before stopping"),
	Flag.filterMap(
		Option.liftPredicate((iterations) => iterations > 0),
		() => "Max iterations must be a positive integer.",
	),
	Flag.withDefault(null),
);

const noMax = Flag.boolean("no-max").pipe(
	Flag.withDescription("Run without an iteration limit"),
);

const CliConfig = {
	prompts,
	filePrompts,
	completionPromise,
	progressFile,
	maxIterations,
	noMax,
	model: Flag.choice("model", Object.values(Models)).pipe(
		Flag.withAlias("m"),
		Flag.withDescription("Model to use"),
		Flag.withDefault(Models.TrinityLarge),
	),
	commandArgs: Argument.string("args").pipe(
		Argument.variadic(),
		Argument.withDescription("Extra argument passed to opencode"),
	),
};

const getMaxIterations = Effect.fn("getMaxIterations")(function* (
	config: RalphConfig,
) {
	if (config.noMax) {
		if (config.maxIterations !== null) {
			return yield* new CliError.UserError({
				cause: "Cannot use no-max and max-iterations at the same time",
			});
		}

		return null;
	}

	return config.maxIterations ?? 10;
});

const ralphLoopCommand = Command.make(
	"ralph-wiggum-loop",
	CliConfig,
	Effect.fnUntraced(function* (options) {
		yield* Effect.log("Starting Ralph loop").pipe(Effect.annotateLogs(options));
		yield* runRalphLoop(options);
	}),
).pipe(
	Command.withDescription(
		"Repeats a prompt until a completion promise appears in output.",
	),
);

const Cli = Command.run(ralphLoopCommand, {
	version: "0.1.0",
});

Cli.pipe(
	Effect.catch((error) => {
		if (CliError.isCliError(error)) {
			return Effect.void;
		}

		return Effect.logFatal(error);
	}),
	Effect.provide([Logger.layer([Logger.consolePretty()]), BunServices.layer]),
	BunRuntime.runMain,
);
