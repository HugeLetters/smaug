import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServiceMap from "effect/ServiceMap";
import { dateTimeConfig } from "~/server/lib/utils/config";
import { Secrets } from "~/server/lib/utils/secrets";

const OauthConfig = Effect.gen(function* () {
	// OAuth client ID for Google APIs
	const clientId = Config.string("client_id");
	const oauth = yield* Config.all({
		clientId,
	}).pipe(Config.nested("oauth"));

	// OAuth client secret stored in Bun.secrets
	const clientSecret = yield* Effect.service(Secrets).pipe(
		Effect.flatMap((s) => s.getOrFail("google_client_secret")),
	);

	return {
		...oauth,
		clientSecret,
	};
});

const SheetConfig = Effect.gen(function* () {
	// Target Google Sheet ID
	const spreadsheetId = Config.string("spreadsheet_id");
	// Worksheet name inside the spreadsheet
	const sheetName = Config.string("sheet_name");

	const column = Schema.Literals([
		"date",
		"by",
		"amount",
		"category",
		"comment",
		"SKIP",
	]);
	// Columns of transaction fields. SKIP means a column is skipped
	const columns = Config.schema(Schema.Array(column), "columns");

	return yield* Config.all({
		spreadsheetId,
		sheetName,
		columns,
	}).pipe(Config.nested("sheet"));
});

const MailConfig = Effect.gen(function* () {
	// Will only process emails after this date (inclusive)
	const startDate = dateTimeConfig("start_date");

	// Gmail label to use to mark emails which parser processed
	const processedlabelName = Config.string("label_name");
	// Gmail label to use to mark emails which parser failed to process
	const failedlabelName = Config.string("failed_label_name");
	// Gmail label to use to mark emails which parser skipped
	const skippedlabelName = Config.string("skipped_label_name");

	return yield* Config.all({
		startDate,
		processedlabelName,
		failedlabelName,
		skippedlabelName,
	}).pipe(Config.nested("mail"));
});

export class AppConfig extends ServiceMap.Service<AppConfig>()(
	"smaug/scripts/mail-sync/config/AppConfig",
	{
		make: Effect.gen(function* () {
			const oauth = yield* OauthConfig;
			const mail = yield* MailConfig;
			const sheet = yield* SheetConfig;

			return {
				mail,
				oauth,
				sheet,
			};
		}).pipe(Effect.withSpan("AppConfig")),
	},
) {
	static live = Layer.effect(AppConfig, AppConfig.make);
}
