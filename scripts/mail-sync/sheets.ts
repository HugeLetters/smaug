import * as Effect from "effect/Effect";
import type { SheetsError, Transaction } from "./types";

export const appendTransactions = (
	transactions: Transaction[],
): Effect.Effect<void, SheetsError> =>
	Effect.gen(function* () {
		yield* Effect.log(
			`TODO: Append ${transactions.length} transactions to Google Sheets`,
		);

		/**
		 * TODO: Implement actual Google Sheets API integration
		 *
		 * Example implementation:
		 *
		 * const sheets = google.sheets({ version: "v4", auth: oauth2Client });
		 *
		 * const values = transactions.map(t => [
		 *   t.date.toISOString(),
		 *   t.account,
		 *   t.amount.toString(),
		 *   t.currency,
		 *   t.merchant,
		 *   t.bankName,
		 *   t.rawSnippet
		 * ]);
		 *
		 * yield* Effect.tryPromise({
		 *   try: () => sheets.spreadsheets.values.append({
		 *     spreadsheetId: config.spreadsheetId,
		 *     range: "Transactions!A:G",
		 *     valueInputOption: "USER_ENTERED",
		 *     requestBody: { values }
		 *   }),
		 *   catch: (error) => new SheetsError({
		 *     message: "Failed to append transactions",
		 *     cause: error
		 *   })
		 * });
		 */

		for (const transaction of transactions) {
			yield* Effect.log(
				`[${transaction.date.toISOString()}] ${transaction.merchant} - ${transaction.amount} ${transaction.currency}`,
			);
		}
	});

export const ensureHeaders = (
	_spreadsheetId: string,
): Effect.Effect<void, SheetsError> =>
	Effect.gen(function* () {
		yield* Effect.log("TODO: Ensure spreadsheet headers exist");

		/**
		 * TODO: Implement header row check/creation
		 *
		 * Headers should be:
		 * Date | Account | Amount | Currency | Merchant | Bank | Raw Snippet
		 *
		 * Example:
		 *
		 * const sheets = google.sheets({ version: "v4", auth: oauth2Client });
		 *
		 * const headers = ["Date", "Account", "Amount", "Currency", "Merchant", "Bank", "Raw Snippet"];
		 *
		 * yield* Effect.tryPromise({
		 *   try: () => sheets.spreadsheets.values.update({
		 *     spreadsheetId,
		 *     range: "Transactions!A1:G1",
		 *     valueInputOption: "USER_ENTERED",
		 *     requestBody: { values: [headers] }
		 *   }),
		 *   catch: (error) => new SheetsError({
		 *     message: "Failed to ensure headers",
		 *     cause: error
		 *   })
		 * });
		 */

		yield* Effect.log(
			"Headers: Date | Account | Amount | Currency | Merchant | Bank | Raw Snippet",
		);
	});
