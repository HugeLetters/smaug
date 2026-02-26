import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Path from "@effect/platform/Path";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import * as BunCommandExecutor from "@effect/platform-bun/BunCommandExecutor";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { jsonFileConfigProvider } from "~/server/lib/utils/config";
import { Secrets } from "~/server/lib/utils/secrets";
import { EnsureAuthClientAuthenticated } from "./auth";
import { loadConfig } from "./config";
import {
	applyLabel,
	createGmailClient,
	fetchUnprocessedEmails,
	getOrCreateLabel,
} from "./gmail";
import { Google } from "./googleapi";
import { parseEmail } from "./parser";
import { appendTransactions } from "./sheets";
import type { AccountSecretConfig, Transaction } from "./types";

const LABEL_NAME = "synced-to-shared-expenses-sheet";

const Sync = Effect.gen(function* () {
	yield* Effect.log("Starting Gmail sync...");

	const config = yield* loadConfig();
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

		const client = yield* createGmailClient(account);
		const labelId = yield* getOrCreateLabel(client, LABEL_NAME);
		const emails = yield* fetchUnprocessedEmails(client, labelId);

		yield* Effect.log(`Found ${emails.length} unprocessed emails`);

		const transactions: Transaction[] = [];

		for (const email of emails) {
			const parsed = yield* parseEmail(email, account.email);

			if (Option.isSome(parsed)) {
				const transaction = { ...parsed.value, account: account.email };
				transactions.push(transaction);
				yield* applyLabel(client, email.id, labelId);
				yield* Effect.log(
					`Processed transaction: ${transaction.merchant} - ${transaction.amount}`,
				);
			}
		}

		return transactions;
	}).pipe(
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
	({ runOnce }) =>
		Effect.gen(function* () {
			yield* EnsureAuthClientAuthenticated;

			let task = Sync;
			if (!runOnce) {
				task = task.pipe(Effect.schedule(Schedule.cron("0 9 * * *")));
			}

			yield* task;
		}),
).pipe(Command.withDescription("Sync Gmail transaction emails to Google Docs"));

const cli = Command.run(GmailSyncCommand, {
	name: "Gmail Sync",
	version: "v1.0.0",
});

const ConfigLive = Effect.gen(function* () {
	const path = yield* Path.Path;

	const provider = yield* jsonFileConfigProvider({
		path: path.resolve(import.meta.dir, ".config.json"),
	});

	return Layer.setConfigProvider(provider);
}).pipe(Layer.unwrapEffect);

const MainLive = Google.Oauth.OauthClient.Default.pipe(
	Layer.merge(BunCommandExecutor.layer),
	Layer.provideMerge(Secrets.Default("gmail-sync")),
	Layer.provideMerge(ConfigLive),
	Layer.provide(BunFileSystem.layer),
	Layer.provide(BunPath.layer),
);

cli(process.argv).pipe(Effect.provide(MainLive), BunRuntime.runMain);
