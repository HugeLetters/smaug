import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Path from "@effect/platform/Path";
import { BunRuntime } from "@effect/platform-bun";
import * as BunCommandExecutor from "@effect/platform-bun/BunCommandExecutor";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunTerminal from "@effect/platform-bun/BunTerminal";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { jsonFileConfigProvider } from "~/server/lib/utils/config";
import { Secrets } from "~/server/lib/utils/secrets";
import { EnsureAuthClientAuthenticated } from "./auth";
import { type AccountSecretConfig, AppConfig } from "./config";
import { Google } from "./googleapi";
import { applyLabel, EnsureMailLabel, getUnprocessedEmails } from "./mail";
import { parseEmail } from "./parser";
import { appendTransactions } from "./sheets";
import type { Transaction } from "./types";

const Sync = Effect.gen(function* () {
	yield* Effect.log("Starting Gmail sync...");

	const config = {};
	yield* Effect.log(`Processing ${config.accounts.length} accounts`);

	const results = yield* Effect.all(
		config.accounts.map((account) =>
			processAccount(account, config.spreadsheetId).pipe(
				Effect.catchAll((error) =>
					Effect.logError(`Failed to process ${account.email}: ${error}`).pipe(
						Effect.map(() => [] as Transaction[]),
					),
				),
			),
		),
		{ concurrency: 1 },
	);

	const allTransactions = results.flat();
	yield* Effect.log(`Found ${allTransactions.length} transactions`);

	if (allTransactions.length > 0) {
		yield* appendTransactions(allTransactions);
		yield* Effect.log("Transactions written to sheet");
	}

	yield* Effect.log("Sync complete");
});

const processAccount = (account: AccountSecretConfig, _spreadsheetId: string) =>
	Effect.gen(function* () {
		yield* Effect.log(`Processing account: ${account.email}`);

		const gmailConfig = yield* MailConfig;
		const emails = yield* getUnprocessedEmails(gmailConfig.labelId);

		yield* Effect.log(`Found ${emails.length} unprocessed emails`);

		const transactions: Transaction[] = [];

		for (const email of emails) {
			const parsed = yield* parseEmail(email, account.email);

			if (Option.isSome(parsed)) {
				const transaction = { ...parsed.value, account: account.email };
				transactions.push(transaction);
				yield* applyLabel(email.id, gmailConfig.labelId);
				yield* Effect.log(
					`Processed transaction: ${transaction.merchant} - ${transaction.amount}`,
				);
			}
		}

		return transactions;
	}).pipe(
		Effect.provide(MailConfig.Default({ labelName: account.label })),
		Effect.catchAll((error) =>
			Effect.gen(function* () {
				yield* Effect.logError(
					`Error processing account ${account.email}: ${error}`,
				);

				return Arr.empty<Transaction>();
			}),
		),
	);

const GmailSyncCommand = Command.make(
	"gmail-sync",
	{
		runOnce: Options.boolean("run-once").pipe(
			Options.withDescription("Run the sync once and exit"),
		),
	},
	Effect.fn(function* ({ runOnce }) {
		const m = yield* getUnprocessedEmails(null);
		yield* Effect.log(m.map((m) => m.snippet.trim()));
		const t = true;
		if (t) {
			return;
		}

		// let task = Sync;
		// if (!runOnce) {
		// 	task = task.pipe(Effect.schedule(Schedule.cron("0 9 * * *")));
		// }

		// yield* task;
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

const OauthAuthenticated = Effect.gen(function* () {
	const config = yield* AppConfig;
	return Google.Oauth.OauthClient.live(
		config.oauth.clientId,
		config.oauth.clientSecret,
	);
}).pipe(
	Layer.unwrapEffect,
	Layer.tap((c) => EnsureAuthClientAuthenticated.pipe(Effect.provide(c))),
	Layer.provide([AppConfigLive, SecretsLive, CommandExecutorLive]),
);

const GmailLive = Google.Gmail.GmailClient.live.pipe(
	Layer.tap((c) => EnsureMailLabel.pipe(Effect.provide(c))),
	Layer.provide([AppConfigLive, SecretsLive, OauthAuthenticated]),
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
	FileSystemLive,
	PathLive,
	TerminalLive,
	AppConfigLive,
).pipe(Layer.provideMerge(ConfigLive));

cli(process.argv).pipe(Effect.provide(MainLive), BunRuntime.runMain);
