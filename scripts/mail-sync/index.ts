import { BunRuntime } from "@effect/platform-bun";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Cron from "effect/Cron";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as RateLimiter from "effect/persistence/RateLimiter";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as Terminal from "effect/Terminal";
import { jsonFileConfigProvider } from "~/server/lib/utils/config";
import { Secrets } from "~/server/lib/utils/secrets";
import { Accounts } from "./account.config";
import { SetupAuth } from "./auth";
import { AppConfig } from "./config";
import { Google } from "./googleapi";
import { processMailBatch } from "./mail";

const sync = Effect.fn(function* (batchSize: number) {
	yield* Effect.log("Processing start");

	yield* Effect.retry(
		SetupAuth,
		Schedule.exponential("1 second").pipe(
			Schedule.tap((meta) =>
				Effect.logWarning(
					`Authentication failed. Retrying in ${Duration.format(meta.output)}`,
					meta.input,
				),
			),
		),
	);

	yield* processMailBatch(Accounts, batchSize);

	yield* Effect.log("Processing done");
});

/** Inerrupts on `ctrl-c/ctrl-d`; succeeds if the tty ends */
const TerminalInputQuit = Effect.gen(function* () {
	const terminal = yield* Terminal.Terminal;
	const lifecycle = yield* terminal.readInput;

	yield* Stream.fromQueue(lifecycle).pipe(
		Stream.filter(
			({ key }) => key.ctrl && (key.name === "c" || key.name === "d"),
		),
		Stream.runForEach(() =>
			Effect.logWarning("Shutting down").pipe(Effect.andThen(Effect.interrupt)),
		),
	);
});

const runInteractiveMode = Effect.fn(function* (batchSize: number) {
	const terminal = yield* Terminal.Terminal;

	const input = yield* terminal.readInput;
	const wake = yield* Queue.make<"cron" | "manual">();
	const pendingManual = yield* Ref.make(false);
	const ManualQueueWorker = Stream.fromQueue(input).pipe(
		Stream.filter((event) => event.key.name.toLowerCase() === "r"),
		Stream.runForEach(
			Effect.fnUntraced(function* () {
				const wasPending = yield* Ref.getAndSet(pendingManual, true);
				if (wasPending) {
					yield* Effect.log("Manual sync is already registered");
					return;
				}

				yield* Queue.offer(wake, "manual");
				yield* Effect.log("Manual sync registered");
			}),
		),
	);

	const schedule = Cron.make({
		minutes: [0],
		hours: [9],
		days: [],
		months: [],
		weekdays: [],
	});
	const CronQueueWorker = Stream.fromSchedule(Schedule.cron(schedule)).pipe(
		Stream.runForEach(() => Queue.offer(wake, "cron")),
	);

	const SyncWorker = Stream.fromQueue(wake).pipe(
		Stream.runForEach((trigger) => {
			return sync(batchSize).pipe(
				Effect.catch(Effect.logFatal),
				Effect.satisfiesErrorType<never>(),
				Effect.ensuring(
					trigger === "manual" ? Ref.set(pendingManual, false) : Effect.void,
				),
			);
		}),
	);

	const Worker = Effect.all([ManualQueueWorker, CronQueueWorker, SyncWorker], {
		concurrency: "unbounded",
	});

	yield* Effect.raceFirst(
		TerminalInputQuit.pipe(Effect.andThen(Effect.never)),
		Worker,
	);
});

const GmailSyncCommand = Command.make(
	"gmail-sync",
	{
		runOnce: Flag.Boolean("run-once").pipe(
			Flag.withAlias("o"),
			Flag.withDescription("Run the sync once and exit"),
			Flag.withDefault(false),
		),
		batchSize: Flag.Int("batch-size").pipe(
			Flag.withAlias("s"),
			Flag.withDefault(50),
			Flag.withDescription(
				"How many emails to query during a single process run",
			),
		),
	},
	Effect.fn(function* ({ runOnce, batchSize }) {
		if (runOnce) {
			yield* sync(batchSize);
			return;
		}

		yield* runInteractiveMode(batchSize);
	}),
).pipe(Command.withDescription("Sync Gmail transaction emails to Google Docs"));

const program = Command.run(GmailSyncCommand, {
	version: "v1.0.0",
});

const BunServicesLive = BunServices.layer;
const SecretsLive = Secrets.layer("smaug/gmail-sync");
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

const FirstEmptyRowLive = Google.Sheets.AppendRow.live(1_000).pipe(
	Layer.provide(SheetsLive),
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
	FirstEmptyRowLive,
	Logger.layer([
		Logger.consolePretty({
			colors: true,
			mode: "tty",
			formatDate(date) {
				return `${padNumber(date.getDate())}.${padNumber(date.getMonth() + 1)} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}.${padNumber(date.getMilliseconds(), 3)}`;
			},
		}),
	]),
	Layer.succeed(Logger.LogToStderr, true),
).pipe(Layer.provideMerge(ConfigLive));

program.pipe(Effect.scoped, Effect.provide(MainLive), BunRuntime.runMain({}));

function padNumber(n: number, d = 2) {
	return String(n).padStart(d, "0");
}
