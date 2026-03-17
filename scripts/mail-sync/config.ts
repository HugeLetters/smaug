import * as FileSystem from "@effect/platform/FileSystem";
import { flow } from "effect";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import { dateTimeConfig } from "~/server/lib/utils/config";
import { Secrets } from "~/server/lib/utils/secrets";

const OauthConfig = Effect.gen(function* () {
	const clientId = Config.string("client_id");
	const oauth = yield* Config.all({
		clientId,
	}).pipe(Config.nested("oauth"));

	const clientSecret = yield* Secrets.use((s) =>
		s.getOrFail("google_client_secret"),
	);

	return {
		...oauth,
		clientSecret,
	};
});

const MailConfig = Effect.gen(function* () {
	const startDate = dateTimeConfig("start_date").pipe(
		Config.withDescription(
			"Will only process emails after this date (inclusive)",
		),
	);

	const processedlabelName = Config.string("label_name").pipe(
		Config.withDescription(
			"Gmail label to use to mark emails which parser processed",
		),
	);
	const failedlabelName = Config.string("failed_label_name").pipe(
		Config.withDescription(
			"Gmail label to use to mark emails which parser failed to process",
		),
	);
	const skippedlabelName = Config.string("skipped_label_name").pipe(
		Config.withDescription(
			"Gmail label to use to mark emails which parser skipped",
		),
	);

	return yield* Config.all({
		startDate,
		processedlabelName,
		failedlabelName,
		skippedlabelName,
	}).pipe(Config.nested("mail"));
});

export class AppConfig extends Effect.Service<AppConfig>()(
	"smaug/scripts/mail-sync/config/AppConfig",
	{
		effect: Effect.gen(function* () {
			const oauth = yield* OauthConfig;
			const mail = yield* MailConfig;

			return {
				mail,
				oauth,
			};
		}).pipe(Effect.withSpan("AppConfig")),
	},
) {
	static live = AppConfig.Default;
}

export class Storage extends Schema.Class<Storage>("StorageSchema")({
	transactions: Schema.Array(Schema.Unknown),
}) {}
const StorageFromJson = Schema.parseJson(Storage);

export class JsonDb extends Effect.Service<JsonDb>()(
	"smaug/scripts/mail-sync/config/JsonDb",
	{
		effect: Effect.fn(function* (storagePath: string, fallback: Storage) {
			const fs = yield* FileSystem.FileSystem;

			const mutex = yield* Effect.makeSemaphore(1);
			const withMutex = mutex.withPermits(1);

			const set = Effect.fn("jsondb.set")(function* (storage: Storage) {
				const encoded = yield* Schema.encode(StorageFromJson)(storage);
				yield* fs.writeFileString(storagePath, encoded);
				return storage;
			});

			const Read = Effect.gen(function* () {
				const current = yield* fs
					.readFileString(storagePath)
					.pipe(Effect.flatMap(Schema.decode(StorageFromJson)), Effect.either);

				if (Either.isRight(current)) {
					return current.right;
				}

				switch (current.left._tag) {
					case "SystemError":
					case "ParseError": {
						return yield* set(fallback);
					}
				}

				return yield* current.left;
			});

			return {
				get: withMutex(Read),
				set: flow(set, withMutex),
				update: Effect.fn("jsondb.update")(function* (
					run: (data: Storage) => Storage,
				) {
					const current = yield* Read;
					const updated = run(current);
					return yield* set(updated);
				}, withMutex),
			};
		}),
	},
) {}
