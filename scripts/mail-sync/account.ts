import type * as Arr from "effect/Array";
import * as Chunk from "effect/Chunk";
import * as Data from "effect/Data";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { Google } from "./googleapi";

export const parseTransactionFromEmail = Effect.fn("parseTransactionFromEmail")(
	function* (accounts: ReadonlyArray<Account>, email: Google.Gmail.Email) {
		let failures = Chunk.empty<ParserFailureWithMeta>();

		for (const account of accounts) {
			for (const parser of account.parsers) {
				const attempt = yield* parser.parse(email).pipe(Effect.result);

				if (Result.isSuccess(attempt)) {
					const transaction: Transaction = {
						...attempt.success,
						by: account,
						meta: {
							parserId: parser.parserId,
						},
					};
					return transaction;
				}

				const error = attempt.failure;
				if (error._tag === "ParserFailure") {
					failures = failures.pipe(
						Chunk.append<ParserFailureWithMeta>({
							error: error,
							meta: {
								accountId: account.accountId,
								parserId: parser.parserId,
							},
						}),
					);
				}
			}
		}

		if (!Chunk.isNonEmpty(failures)) {
			return yield* new ParserSkip();
		}

		return yield* Effect.fail<ParserFailureList>({
			_tag: "ParserFailureList",
			failures: Chunk.toReadonlyArray(failures),
		});
	},
);
export enum TransactionCategory {
	Grocery = "Grocery",
	/** Restaraunts/take-out/food delivery */
	Food = "Food",
	/** Rent, phone bills, internet */
	RentAndUtilities = "RentAndUtilities",
	/** Public transport, taxi */
	Transportation = "Transportation",
	Clothing = "Clothing",
	/** Cinema, Travel */
	Entertainment = "Entertainment",
	Charity = "Charity",
	Other = "Other",
}

export interface TransactionData {
	readonly date: DateTime.DateTime;
	readonly category: TransactionCategory;
	/** In local currency */
	readonly amount: number;
	readonly merchant: string;
}

export interface TransactionMeta {
	readonly parserId: string;
}

export interface Transaction extends TransactionData {
	readonly by: Account;
	readonly meta: TransactionMeta;
}

export interface Parser {
	readonly parserId: string;
	readonly parse: (
		email: Google.Gmail.Email,
	) => Effect.Effect<TransactionData, ParserError>;
}

export interface Account {
	readonly accountId: string;
	readonly query: Google.Gmail.Query.Query | null;
	readonly parsers: ReadonlyArray<Parser>;
}

export class ParserSkip extends Data.TaggedError("ParserSkip") {}

export class ParserFailure extends Data.TaggedError("ParserFailure")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface ParserFailureList {
	readonly _tag: "ParserFailureList";
	readonly failures: Arr.NonEmptyReadonlyArray<ParserFailureWithMeta>;
}

export interface ParserFailureWithMeta {
	readonly error: ParserFailure;
	readonly meta: ParserErrorMeta;
}

export interface ParserErrorMeta {
	readonly accountId: string;
	readonly parserId: string;
}

export type ParserError = ParserSkip | ParserFailure;
