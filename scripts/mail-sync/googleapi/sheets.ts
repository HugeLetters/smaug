import { pipe } from "effect";
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Iterable from "effect/Iterable";
import * as Predicate from "effect/Predicate";
import * as RateLimiter from "effect/RateLimiter";
import * as Schedule from "effect/Schedule";
import type { sheets_v4 } from "googleapis";
import { google } from "googleapis";
import { OauthClient } from "./oauth";

export class SheetsClient extends Effect.Service<SheetsClient>()(
	"smaug/googleapi/sheets/SheetsClient",
	{
		scoped: Effect.gen(function* () {
			const oauth = yield* OauthClient;
			const client = yield* oauth.use((auth) =>
				google.sheets({ version: "v4", auth }),
			);

			const limiter = yield* RateLimiter.make({
				limit: 120,
				interval: "1 minute",
				algorithm: "token-bucket",
			});

			const readLimiter = yield* RateLimiter.make({
				limit: 60,
				interval: "1 minute",
				algorithm: "fixed-window",
			});
			const writeLimiter = yield* RateLimiter.make({
				limit: 60,
				interval: "1 minute",
				algorithm: "fixed-window",
			});

			const use = Effect.fn("sheets.use")(
				<T>(run: (client: sheets_v4.Sheets) => T | Promise<T>) =>
					Effect.tryPromise({
						async try() {
							return run(client);
						},
						catch(error) {
							return new SheetsError({ cause: error });
						},
					}),
				limiter,
			);

			return {
				use,
				useRead: Effect.fn("sheets.useRead")(use, readLimiter),
				useWrite: Effect.fn("sheets.useWrite")(use, writeLimiter),
			};
		}),
	},
) {
	static live = SheetsClient.Default;
}

export type CellValue = string | number | boolean | null;

export enum ValueInputOptions {
	raw = "RAW",
	userEntered = "USER_ENTERED",
}

export const readRow = Effect.fn("sheets.readRow")(function* (options: {
	readonly spreadsheetId: string;
	readonly sheetName: string;
	readonly row: number;
	readonly startColumn?: string;
	readonly endColumn?: string;
}) {
	const sheets = yield* SheetsClient;
	const startColumn = options.startColumn ?? "A";
	const endColumn = options.endColumn ?? startColumn;

	const range = makeRange({
		sheetName: options.sheetName,
		startColumn,
		endColumn,
		startRow: options.row,
		endRow: options.row,
	});

	const response = yield* sheets
		.useRead((client) =>
			client.spreadsheets.values.get({
				spreadsheetId: options.spreadsheetId,
				range,
				majorDimension: Dimension.rows,
			}),
		)
		.pipe(Effect.retry(RetrySchedule));

	const out: Array<CellValue> = response.data.values?.[0] ?? [];
	return out;
});

enum Dimension {
	rows = "ROWS",
	columns = "COLUMNS",
}

export enum InsertDataOption {
	overwrite = "OVERWRITE",
	insert = "INSERT_ROWS",
}

interface BaseRowWriteOptions {
	readonly spreadsheetId: string;
	readonly sheetName: string;
	readonly startColumn?: string;
	readonly valueInputOption?: ValueInputOptions;
}
interface AppendRowOptions extends BaseRowWriteOptions {
	insertDataOption?: InsertDataOption;
}

// TODO gmail-sync | batching? | by Evgenii Perminov at Wed, 18 Mar 2026 01:02:00 GMT
export const appendRow = Effect.fn("sheets.writeRowToFirstEmpty")(function* (
	values: ReadonlyArray<CellValue>,
	options: AppendRowOptions,
) {
	const {
		valueInputOption = ValueInputOptions.userEntered,
		startColumn = "A",
		insertDataOption = InsertDataOption.insert,
	} = options;

	const sheets = yield* SheetsClient;

	const endColumn = indexToColumn(
		columnToIndex(startColumn) + values.length - 1,
	);
	const range = makeRange({
		sheetName: options.sheetName,
		startColumn: startColumn,
		endColumn,
		startRow: 1,
		endRow: 1,
	});

	yield* sheets
		.useWrite((client) => {
			return client.spreadsheets.values.append({
				spreadsheetId: options.spreadsheetId,
				range,
				requestBody: {
					values: [Array.from(values)],
				},
				valueInputOption,
				insertDataOption,
			});
		})
		.pipe(
			Effect.retry(RetrySchedule),
			Effect.catchTag("SheetsError", (err) =>
				SheetsWriteError.fail(
					`Failed to append row '${values.join(", ")}' at '${range}'`,
					err.cause,
				),
			),
		);
});

export interface WriteRowOptions extends BaseRowWriteOptions {
	readonly row: number;
}

export const writeRow = Effect.fn("sheets.writeRow")(function* (
	values: ReadonlyArray<CellValue>,
	options: WriteRowOptions,
) {
	const sheets = yield* SheetsClient;

	const {
		startColumn = "A",
		valueInputOption = ValueInputOptions.userEntered,
	} = options;

	const updates = makeSpareUpdateBatch(
		values,
		options.sheetName,
		options.row,
		startColumn,
	);

	if (updates.length === 0) {
		return;
	}

	yield* sheets
		.useWrite((client) => {
			return client.spreadsheets.values.batchUpdate({
				spreadsheetId: options.spreadsheetId,
				requestBody: {
					valueInputOption,
					data: updates,
				},
			});
		})
		.pipe(
			Effect.retry(RetrySchedule),
			Effect.catchTag("SheetsError", (err) =>
				SheetsWriteError.fail(
					`Failed to write to row ${options.row}`,
					err.cause,
				),
			),
		);
});

function makeSpareUpdateBatch(
	values: ReadonlyArray<CellValue>,
	sheetName: string,
	row: number,
	startColumn: string,
) {
	const startIndex = columnToIndex(startColumn);

	return pipe(
		Arr.chop(values, (arr) => {
			const [before, after] = Arr.splitWhere(arr, Predicate.isNull);
			if (!Arr.isNonEmptyArray(before)) {
				return [null, after.slice(1)];
			}

			return [
				{
					start: values.length - arr.length,
					values: before,
				},
				after.slice(1),
			];
		}),
		Iterable.filter(Predicate.isNotNull),
		Iterable.map(
			({ start, values: sliceValues }): sheets_v4.Schema$ValueRange => ({
				range: makeRange({
					sheetName,
					startColumn: indexToColumn(startIndex + start),
					endColumn: indexToColumn(startIndex + start + sliceValues.length - 1),
					endRow: row,
				}),
				values: [sliceValues],
			}),
		),
		Arr.fromIterable,
	);
}

function normalizeColumn(column: string) {
	return column.trim().toUpperCase();
}

function columnToIndex(column: string) {
	const normalized = normalizeColumn(column);
	return Iterable.reduce(normalized, 0, (acc, char) => {
		const offset = char.charCodeAt(0) - 64;
		return acc * 26 + offset;
	});
}

function indexToColumn(index: number) {
	if (index <= 0) {
		return "A";
	}

	let result = "";
	let current = index;
	while (current > 0) {
		const mod = (current - 1) % 26;
		result = String.fromCharCode(65 + mod) + result;
		current = Math.floor((current - 1) / 26);
	}
	return result;
}

export interface RangeOptions {
	readonly sheetName: string;
	readonly startColumn?: string;
	readonly endColumn?: string;
	readonly startRow?: number;
	readonly endRow?: number;
}

export function makeRange(options: RangeOptions) {
	const startColumn = normalizeColumn(options.startColumn ?? "A");
	const endColumn = normalizeColumn(options.endColumn ?? startColumn);
	const startRow = options.startRow;
	const endRow = options.endRow;

	const start =
		startRow !== undefined ? `${startColumn}${startRow}` : startColumn;
	const end = endRow !== undefined ? `${endColumn}${endRow}` : endColumn;

	return `${options.sheetName}!${start}:${end}`;
}

export class SheetsError extends Data.TaggedError("SheetsError")<{
	cause: unknown;
}> {}

export class SheetsWriteError extends Data.TaggedError("SheetsWriteError")<{
	message: string;
	cause?: unknown;
}> {
	static fail(message: string, cause?: unknown) {
		return new SheetsWriteError({ message, cause });
	}
}

const RetrySchedule = pipe(
	Schedule.exponential(Duration.seconds(1)),
	Schedule.intersect(Schedule.recurs(5)),
);
