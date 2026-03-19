import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Path from "@effect/platform/Path";
import { BunRuntime } from "@effect/platform-bun";
import * as BunCommandExecutor from "@effect/platform-bun/BunCommandExecutor";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunTerminal from "@effect/platform-bun/BunTerminal";
import * as Cron from "effect/Cron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { jsonFileConfigProvider } from "~/server/lib/utils/config";
import { Secrets } from "~/server/lib/utils/secrets";
import { Accounts } from "./account.config";
import { SetupAuth } from "./auth";
import { AppConfig } from "./config";
import { Google } from "./googleapi";
import { processMailBatch } from "./mail";

const sync = Effect.fn(function* (batchSize: number) {
	yield* SetupAuth;

	yield* processMailBatch(Accounts, batchSize);
});

const GmailSyncCommand = Command.make(
	"gmail-sync",
	{
		runOnce: Options.boolean("run-once").pipe(
			Options.withAlias("o"),
			Options.withDescription("Run the sync once and exit"),
		),
		batchSize: Options.integer("batch-size").pipe(
			Options.withAlias("s"),
			Options.withDefault(10),
			Options.withDescription("Run the sync once and exit"),
		),
	},
	Effect.fn(function* ({ runOnce, batchSize }) {
		let task = sync(batchSize);

		if (!runOnce) {
			const schedule = Cron.make({
				minutes: [0],
				hours: [9],
				days: [],
				months: [],
				weekdays: [],
			});

			task = task.pipe(
				Effect.catchAll(Effect.logFatal),
				Effect.repeat(Schedule.cron(schedule)),
				Effect.ensureErrorType<never>(),
			);
		}

		yield* task;
	}),
).pipe(Command.withDescription("Sync Gmail transaction emails to Google Docs"));

const cli = Command.run(GmailSyncCommand, {
	name: "Gmail Sync",
	version: "v1.0.0",
});

const FileSystemLive = BunFileSystem.layer;
const PathLive = BunPath.layer;
const CommandExecutorLive = BunCommandExecutor.layer.pipe(
	Layer.provide(FileSystemLive),
);
const TerminalLive = BunTerminal.layer;

const SecretsLive = Secrets.live("gmail-sync");
const AppConfigLive = AppConfig.live.pipe(Layer.provide(SecretsLive));

const OauthLive = Effect.gen(function* () {
	const config = yield* AppConfig;
	return Google.Oauth.OauthClient.live(
		config.oauth.clientId,
		config.oauth.clientSecret,
	);
}).pipe(Layer.unwrapEffect, Layer.provide([AppConfigLive]));

const GmailLive = Google.Gmail.GmailClient.live.pipe(
	Layer.provide([AppConfigLive, OauthLive]),
);

const SheetsLive = Google.Sheets.SheetsClient.live.pipe(
	Layer.provide([AppConfigLive, OauthLive]),
);

const ConfigLive = Effect.gen(function* () {
	const path = yield* Path.Path;

	const provider = yield* jsonFileConfigProvider({
		path: path.resolve(import.meta.dir, ".config.json"),
	});

	return Layer.setConfigProvider(provider);
}).pipe(Layer.unwrapEffect, Layer.provide([PathLive, FileSystemLive]));

const MainLive = Layer.mergeAll(
	GmailLive,
	SheetsLive,
	FileSystemLive,
	PathLive,
	TerminalLive,
	AppConfigLive,
	OauthLive,
	SecretsLive,
	CommandExecutorLive,
).pipe(Layer.provideMerge(ConfigLive));

cli(process.argv).pipe(Effect.provide(MainLive), BunRuntime.runMain);
