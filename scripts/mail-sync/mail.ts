import { pipe } from "effect";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Iterable from "effect/Iterable";
import * as Schedule from "effect/Schedule";
import {
	type Account,
	parseTransactionFromEmail,
	type Transaction,
} from "./account";
import { AppConfig } from "./config";
import { Google } from "./googleapi";
import type { Gmail } from "./googleapi/index.export";

class LabelConfig extends Effect.Service<LabelConfig>()(
	"smaug/scripts/mail-sync/mail/LabelConfig",
	{
		effect: Effect.gen(function* () {
			const config = yield* AppConfig;

			const label = yield* Effect.all({
				processed: ensureLabel({
					name: config.mail.processedlabelName,
					bg: "#16a765",
					text: "#ffffff",
				}),
				failed: ensureLabel({
					name: config.mail.failedlabelName,
					bg: "#0b804b",
					text: "#ffffff",
				}),
				skipped: ensureLabel({
					name: config.mail.skippedlabelName,
					bg: "#149e60",
					text: "#ffffff",
				}),
			});

			return {
				label,
			};
		}),
	},
) {}

export const processMailBatch = Effect.fn("processMailBatch")(
	function* (accounts: ReadonlyArray<Account>, size: number) {
		const query = resolveAccountsQuery(accounts);
		const emails = yield* getUnprocessedEmails(query, size);

		yield* Effect.forEach(
			emails,
			(email) => {
				return processMail(accounts, email).pipe(
					Effect.catchAll((err) =>
						Effect.logError(
							`Failed to process email: ${email.id}`,
							`Snippet: ${formatSnippet(email.snippet)}`,
							err,
						),
					),
				);
			},
			{ concurrency: "unbounded" },
		);
	},
	// before each batch ensure labels exist
	Effect.provide(LabelConfig.Default),
);

function resolveAccountsQuery(accounts: ReadonlyArray<Account>) {
	return pipe(
		accounts,
		Iterable.map((account) => account.query),
		Iterable.filter((query) => query !== null),
		Iterable.reduce(null, (acc: Gmail.Query.Query | null, query) => {
			if (acc === null) {
				return query;
			}

			return Google.Gmail.Query.or(acc, query);
		}),
	);
}

// TODO gmail-sync | some locking mechanism to prevent double-counting | by Evgenii Perminov at Mon, 09 Mar 2026 21:06:50 GMT
const processMail = Effect.fn("processMail")(function* (
	accounts: ReadonlyArray<Account>,
	email: Google.Gmail.Email,
) {
	const config = yield* LabelConfig;
	yield* parseTransactionFromEmail(accounts, email).pipe(
		Effect.tap((transaction) => saveTransaction(transaction)),
		Effect.tapErrorTag("ParserSkip", () =>
			Effect.logWarning(
				`Skipped email ${email.id}`,
				`Snippet: ${formatSnippet(email.snippet)}`,
			),
		),
		Effect.tapErrorTag("ParserFailureList", (err) =>
			Effect.logError(
				`Failed to parse email ${email.id}`,
				`Snippet: ${formatSnippet(email.snippet)}`,
				err.failures.map((failure) => failure.error),
			),
		),
		Effect.tapErrorTag("SheetsWriteError", (err) =>
			Effect.logError(
				`Failed to save email ${email.id}`,
				`Snippet: ${formatSnippet(email.snippet)}`,
				err,
			),
		),
		Effect.matchEffect({
			onSuccess() {
				return applyLabel(email.id, config.label.processed);
			},
			onFailure(error) {
				switch (error._tag) {
					case "ParserSkip":
						return applyLabel(email.id, config.label.skipped);
					// TODO gmail-sync | log error | by Evgenii Perminov at Tue, 17 Mar 2026 02:36:02 GMT
					case "ParserFailureList":
					case "SheetsWriteError":
						return applyLabel(email.id, config.label.failed);
				}
			},
		}),
	);
});

const saveTransaction = Effect.fn("save-transaction")(function* (
	transaction: Transaction,
) {
	const config = yield* AppConfig;

	const getValue = (column: (typeof config.sheet.columns)[number]) => {
		switch (column) {
			case "date":
				return DateTime.formatIsoDateUtc(transaction.date);
			case "by":
				return transaction.by.accountId;
			case "amount":
				return transaction.amount;
			case "category":
				return transaction.category;
			case "comment":
				return transaction.merchant;
			case "SKIP":
				return null;
		}

		return null;
	};

	const values = config.sheet.columns.map(getValue);

	yield* Google.Sheets.appendRow(values, {
		spreadsheetId: config.sheet.spreadsheetId,
		sheetName: config.sheet.sheetName,
	});
});

interface Label {
	readonly name: string;
	readonly bg: ValidLabelColor;
	readonly text: ValidLabelColor;
}

const ensureLabel = Effect.fn(function* (label: Label) {
	const gmail = yield* Google.Gmail.GmailClient;

	const foundLabel = yield* gmail
		.use((client) => client.users.labels.list({ userId: Google.Gmail.ME }))
		.pipe(
			Effect.retry(RetrySchedule),
			Effect.map((res) => res.data.labels ?? []),
			Effect.map((res) => res.find((result) => result.name === label.name)),
		);

	if (foundLabel) {
		const foundId = foundLabel.id;
		if (!foundId) {
			return yield* MailError.fail("Found Label does not have an ID attached");
		}

		const foundColor = foundLabel.color;
		const hasConfigMismatch =
			foundColor?.backgroundColor !== label.bg ||
			foundColor?.textColor !== label.text;

		if (hasConfigMismatch) {
			yield* Effect.log(`Syncing label ${label.name} config`);
			yield* gmail
				.use((client) =>
					client.users.labels.patch({
						userId: Google.Gmail.ME,
						id: foundId,
						requestBody: {
							color: {
								backgroundColor: label.bg,
								textColor: label.text,
							},
						},
					}),
				)
				.pipe(Effect.retry(RetrySchedule));
		}

		return foundId;
	}

	const createdLabel = yield* gmail
		.use((client) =>
			client.users.labels.create({
				userId: Google.Gmail.ME,
				requestBody: {
					name: label.name,
					labelListVisibility: "labelShow",
					messageListVisibility: "show",
					color: {
						backgroundColor: label.bg,
						textColor: label.text,
					},
				},
			}),
		)
		.pipe(Effect.retry(RetrySchedule));

	const createdId = createdLabel.data.id;
	if (!createdId) {
		return yield* MailError.fail(
			`Created label but no ID returned: ${label.name}`,
		);
	}

	return createdId;
});

const getUnprocessedEmails = Effect.fn("fetchUnprocessedEmails")(function* (
	query: Google.Gmail.Query.Query | null,
	limit: number,
) {
	const config = yield* AppConfig;

	const finalQuery = Google.Gmail.Query.build((q) => {
		const Completed = q.label(config.mail.processedlabelName);
		const FailedToProcess = q.label(config.mail.failedlabelName);
		const Skipped = q.label(config.mail.skippedlabelName);

		const Processed = pipe(
			Completed,
			(_) => q.or(_, FailedToProcess),
			(_) => q.or(_, Skipped),
		);

		const BaseQuery = q.not(Processed);

		if (query === null) {
			return BaseQuery;
		}

		return q.and(BaseQuery, query);
	});

	return yield* Google.Gmail.searchEmails(finalQuery, limit).pipe(
		Effect.retry(RetrySchedule),
	);
});

const applyLabel = Effect.fn("applyLabel")(function* (
	emailId: string,
	labelId: string,
) {
	const gmail = yield* Google.Gmail.GmailClient;

	yield* gmail
		.use((client) =>
			client.users.messages.modify({
				userId: Google.Gmail.ME,
				id: emailId,
				requestBody: {
					addLabelIds: [labelId],
				},
			}),
		)
		.pipe(Effect.retry(RetrySchedule));
});

export class MailError extends Data.TaggedError("MailError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {
	static fail(message: string, cause?: unknown) {
		return new MailError({ message, cause });
	}
}

const RetrySchedule = pipe(
	Schedule.exponential(Duration.seconds(1)),
	Schedule.intersect(Schedule.recurs(5)),
);

function formatSnippet(snippet: string) {
	const trimmed = snippet.replace(/\s+/g, " ").trim();
	if (trimmed.length <= 160) {
		return trimmed;
	}

	return `${trimmed.slice(0, 157)}...`;
}

type ValidLabelColor =
	| "#000000"
	| "#434343"
	| "#666666"
	| "#999999"
	| "#cccccc"
	| "#efefef"
	| "#f3f3f3"
	| "#ffffff"
	| "#fb4c2f"
	| "#ffad47"
	| "#fad165"
	| "#16a766"
	| "#43d692"
	| "#4a86e8"
	| "#a479e2"
	| "#f691b3"
	| "#f6c5be"
	| "#ffe6c7"
	| "#fef1d1"
	| "#b9e4d0"
	| "#c6f3de"
	| "#c9daf8"
	| "#e4d7f5"
	| "#fcdee8"
	| "#efa093"
	| "#ffd6a2"
	| "#fce8b3"
	| "#89d3b2"
	| "#a0eac9"
	| "#a4c2f4"
	| "#d0bcf1"
	| "#fbc8d9"
	| "#e66550"
	| "#ffbc6b"
	| "#fcda83"
	| "#44b984"
	| "#68dfa9"
	| "#6d9eeb"
	| "#b694e8"
	| "#f7a7c0"
	| "#cc3a21"
	| "#eaa041"
	| "#f2c960"
	| "#149e60"
	| "#3dc789"
	| "#3c78d8"
	| "#8e63ce"
	| "#e07798"
	| "#ac2b16"
	| "#cf8933"
	| "#d5ae49"
	| "#0b804b"
	| "#2a9c68"
	| "#285bac"
	| "#653e9b"
	| "#b65775"
	| "#822111"
	| "#a46a21"
	| "#aa8831"
	| "#076239"
	| "#1a764d"
	| "#1c4587"
	| "#41236d"
	| "#83334c"
	| "#464646"
	| "#e7e7e7"
	| "#0d3472"
	| "#b6cff5"
	| "#0d3b44"
	| "#98d7e4"
	| "#3d188e"
	| "#e3d7ff"
	| "#711a36"
	| "#fbd3e0"
	| "#8a1c0a"
	| "#f2b2a8"
	| "#7a2e0b"
	| "#ffc8af"
	| "#7a4706"
	| "#ffdeb5"
	| "#594c05"
	| "#fbe983"
	| "#684e07"
	| "#fdedc1"
	| "#0b4f30"
	| "#b3efd3"
	| "#04502e"
	| "#a2dcc1"
	| "#c2c2c2"
	| "#4986e7"
	| "#2da2bb"
	| "#b99aff"
	| "#994a64"
	| "#f691b2"
	| "#ff7537"
	| "#ffad46"
	| "#662e37"
	| "#ebdbde"
	| "#cca6ac"
	| "#094228"
	| "#42d692"
	| "#16a765";
