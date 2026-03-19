import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
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

const SheetConfig = Effect.gen(function* () {
	const spreadsheetId = Config.string("spreadsheet_id").pipe(
		Config.withDescription("Target Google Sheet ID"),
	);
	const sheetName = Config.string("sheet_name").pipe(
		Config.withDescription("Worksheet name inside the spreadsheet"),
	);

	const column = Config.literal(
		"date",
		"by",
		"amount",
		"category",
		"comment",
		"SKIP",
	)();
	const columns = Config.array(column, "columns").pipe(
		Config.withDescription(
			"Columns of transaction fields. SKIP means a column is skipped",
		),
	);

	return yield* Config.all({
		spreadsheetId,
		sheetName,
		columns,
	}).pipe(Config.nested("sheet"));
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
			const sheet = yield* SheetConfig;

			return {
				mail,
				oauth,
				sheet,
			};
		}).pipe(Effect.withSpan("AppConfig")),
	},
) {
	static live = AppConfig.Default;
}
