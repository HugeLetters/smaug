import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const TransactionSchema = Schema.Struct({
	id: Schema.String,
	date: Schema.DateFromNumber,
	amount: Schema.Number,
	currency: Schema.String.pipe(Schema.optionalWith({ default: () => "CLP" })),
	merchant: Schema.String,
	account: Schema.String,
	bankName: Schema.Union(
		Schema.Literal("Banco BCI"),
		Schema.Literal("Banco de Chile"),
	),
	rawEmailId: Schema.String,
	rawSnippet: Schema.String,
});

export type Transaction = typeof TransactionSchema.Type;
export type Bank = Transaction["bankName"];

export const GmailAccountSchema = Schema.Struct({
	email: Schema.String,
	credentialsPath: Schema.String,
	tokenPath: Schema.String,
});

export type GmailAccount = typeof GmailAccountSchema.Type;

export const ConfigSchema = Schema.Struct({
	accounts: Schema.Array(GmailAccountSchema),
	spreadsheetId: Schema.String,
	labelName: Schema.String.pipe(
		Schema.optionalWith({ default: () => "synced-to-shared-expenses-sheet" }),
	),
	cronSchedule: Schema.String.pipe(
		Schema.optionalWith({ default: () => "0 9 * * *" }),
	),
});

export type Config = typeof ConfigSchema.Type;

export const EmailSchema = Schema.Struct({
	id: Schema.String,
	snippet: Schema.String,
	payload: Schema.Unknown,
});

export type Email = typeof EmailSchema.Type;

export class GmailSyncError extends Data.TaggedError("GmailSyncError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class ConfigError extends Data.TaggedError("ConfigError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class ParserError extends Data.TaggedError("ParserError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class SheetsError extends Data.TaggedError("SheetsError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface BankParser {
	readonly name: string;
	readonly parse: (
		email: Email,
	) => Effect.Effect<Option.Option<Transaction>, ParserError>;
}
