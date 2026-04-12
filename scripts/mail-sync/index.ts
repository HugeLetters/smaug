import { BunRuntime } from "@effect/platform-bun";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Cron from "effect/Cron";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as RateLimiter from "effect/unstable/persistence/RateLimiter";
import { jsonFileConfigProvider } from "~/server/lib/utils/config";
import { Secrets } from "~/server/lib/utils/secrets";
import { Schedule$ } from "~/utils/schedule";
import { Accounts } from "./account.config";
import { SetupAuth } from "./auth";
import { AppConfig } from "./config";
import { Google } from "./googleapi";
import { processMailBatch } from "./mail";

const sync = Effect.fn(function* (batchSize: number) {
	yield* SetupAuth.pipe(
		Effect.retry(
			Schedule.exponential("1 second").pipe((s) =>
				Schedule$.tap(s, (err, duration) =>
					Effect.logWarning(
						`Authentication failed. Retrying in ${Duration.format(duration)}`,
						err,
					),
				),
			),
		),
	);

	yield* processMailBatch(Accounts, batchSize);
	yield* Effect.log("Batch processing finished");
});

const GmailSyncCommand = Command.make(
	"gmail-sync",
	{
		runOnce: Flag.boolean("run-once").pipe(
			Flag.withAlias("o"),
			Flag.withDescription("Run the sync once and exit"),
		),
		batchSize: Flag.integer("batch-size").pipe(
			Flag.withAlias("s"),
			Flag.withDefault(50),
			Flag.withDescription(
				"How many emails to query during a single process run",
			),
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
				Effect.repeat(Schedule.cron(schedule)),
				Effect.catch(Effect.logFatal),
				Effect.satisfiesErrorType<never>(),
			);
		}

		yield* task;
	}),
).pipe(Command.withDescription("Sync Gmail transaction emails to Google Docs"));

const program = Command.run(GmailSyncCommand, {
	version: "v1.0.0",
});

const BunServicesLive = BunServices.layer;
const SecretsLive = Secrets.live("gmail-sync");
const AppConfigLive = AppConfig.live.pipe(Layer.provide(SecretsLive));

const layerStoreMemory = RateLimiter.layerStoreMemory;
const RateLimiterLive = RateLimiter.layer.pipe(Layer.provide(layerStoreMemory));

const OauthLive = Effect.gen(function* () {
	const config = yield* AppConfig;
	return Google.Oauth.OauthClient.live(
		config.oauth.clientId,
		config.oauth.clientSecret,
	);
}).pipe(Layer.unwrap, Layer.provide([AppConfigLive]));

const GmailLive = Google.Gmail.GmailClient.live.pipe(
	Layer.provide([OauthLive, RateLimiterLive]),
);

const SheetsLive = Google.Sheets.SheetsClient.live.pipe(
	Layer.provide([OauthLive, RateLimiterLive]),
);

const ConfigLive = Effect.gen(function* () {
	const path = yield* Path.Path;

	const provider = yield* jsonFileConfigProvider({
		path: path.resolve(import.meta.dir, ".config.json"),
	});

	return ConfigProvider.layer(provider);
}).pipe(Layer.unwrap, Layer.provide([BunServicesLive]));

const MainLive = Layer.mergeAll(
	BunServicesLive,
	SecretsLive,
	AppConfigLive,
	OauthLive,
	GmailLive,
	SheetsLive,
	Logger.layer([
		Logger.consolePretty({ colors: true, mode: "tty", stderr: true }),
	]),
).pipe(Layer.provideMerge(ConfigLive));

program.pipe(Effect.provide(MainLive), BunRuntime.runMain({}));
