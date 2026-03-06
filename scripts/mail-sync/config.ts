import * as Config from "effect/Config";
import * as ConfigError from "effect/ConfigError";
import * as Cron from "effect/Cron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { dateTimeConfig } from "~/server/lib/utils/config";
import { Secrets } from "~/server/lib/utils/secrets";

interface AccountConfig {
	/** Account name */
	name: string;
	/** Schedule for email parsing */
	schedule: Cron.Cron;
}

export const AccountSecretConfig = Schema.Struct({
	/** Account email */
	email: Schema.String,
	/** Label used to mark emails as parsed */
	label: Schema.String,
	/** Google API token */
	token: Schema.String,
}).pipe((s) => Schema.parseJson(s));

export type AccountSecretConfig = typeof AccountSecretConfig.Type;

export const GetAccountConfigs = Effect.succeed<ReadonlyArray<AccountConfig>>([
	{
		name: "HugeLetters",
		schedule: Cron.make({
			minutes: [0],
			hours: [9],
			days: [],
			weekdays: [],
			months: [],
		}),
	},
]);

export const GetSpreadsheetId = Effect.gen(function* () {
	const secrets = yield* Secrets;
	const id = yield* secrets.get("spreadsheet-id");
	if (id === null) {
		return yield* Effect.fail(
			ConfigError.MissingData(
				["spreadsheet-id"],
				"Missing Google Docs Spreadsheet ID",
			),
		);
	}

	return id;
});

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
	const labelName = Config.string("label_name").pipe(
		Config.withDescription(
			"Gmail label to use to mark emails which parser processed",
		),
	);
	const failedLabelName = Config.string("failed_label_name").pipe(
		Config.withDescription(
			"Gmail label to use to mark emails which parser failed to process",
		),
	);

	return yield* Config.all({
		startDate,
		labelName,
		failedLabelName,
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
