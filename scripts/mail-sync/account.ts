import type * as Arr from "effect/Array";
import * as Chunk from "effect/Chunk";
import * as Data from "effect/Data";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import type { Google } from "./googleapi";

export const parseTransactionFromEmail = Effect.fn("parseTransactionFromEmail")(
	function* (accounts: ReadonlyArray<Account>, email: Google.Gmail.Email) {
		let failures = Chunk.empty<ParserFailureWithMeta>();

		for (const account of accounts) {
			for (const bank of account.banks) {
				for (const parser of bank.parsers) {
					const attempt = yield* parser.parse(email).pipe(Effect.either);

					if (Either.isRight(attempt)) {
						const transaction: Transaction = {
							...attempt.right,
							meta: {
								accountId: account.accountId,
								bankId: bank.bankId,
								parserId: parser.parserId,
							},
						};
						return transaction;
					}

					const error = attempt.left;
					if (error._tag === "ParserFailure") {
						failures = failures.pipe(
							Chunk.append<ParserFailureWithMeta>({
								error: error,
								meta: {
									accountId: account.accountId,
									bankId: bank.bankId,
									parserId: parser.parserId,
								},
							}),
						);
					}
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

export interface TransactionData {
	readonly date: DateTime.DateTime;
	readonly amount: number;
	readonly currency: string;
	readonly merchant: string;
}

export interface TransactionMeta {
	readonly accountId: string;
	readonly bankId: string;
	readonly parserId: string;
}

export interface Transaction extends TransactionData {
	readonly meta: TransactionMeta;
}

export interface Parser {
	readonly parserId: string;
	readonly parse: (
		email: Google.Gmail.Email,
	) => Effect.Effect<TransactionData, ParserError>;
}

export interface Bank {
	readonly bankId: string;
	readonly parsers: ReadonlyArray<Parser>;
}

export interface Account {
	readonly accountId: string;
	readonly query: Google.Gmail.Query.Query | null;
	readonly banks: ReadonlyArray<Bank>;
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
	readonly bankId: string;
	readonly parserId: string;
}

export type ParserError = ParserSkip | ParserFailure;
