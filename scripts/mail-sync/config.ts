import * as ConfigError from "effect/ConfigError";
import * as Cron from "effect/Cron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
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
