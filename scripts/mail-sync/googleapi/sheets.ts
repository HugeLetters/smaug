import { flow, pipe } from "effect";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Iterable from "effect/Iterable";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as RateLimiter from "effect/unstable/persistence/RateLimiter";
import type { sheets_v4 } from "googleapis";
import { google } from "googleapis";
import { Google } from ".";
import { OauthClient } from "./oauth";

export class SheetsClient extends Context.Service<SheetsClient>()(
	"smaug/googleapi/sheets/SheetsClient",
	{
		make: Effect.gen(function* () {
			const oauth = yield* OauthClient;
			const client = yield* oauth.use((auth) =>
				google.sheets({ version: "v4", auth }),
			);

			const rateLimiter = yield* RateLimiter.makeWithRateLimiter;
			const rateLimitInterval = Duration.seconds(10);

			const limiter = rateLimiter({
				key: "sheets",
				limit: 20,
				window: rateLimitInterval,
				onExceeded: "delay",
				algorithm: "token-bucket",
			});

			const readLimiter = rateLimiter({
				key: "sheets-read",
				limit: 10,
				window: rateLimitInterval,
				onExceeded: "delay",
				algorithm: "fixed-window",
			});

			const writeLimiter = rateLimiter({
				key: "sheets-write",
				limit: 10,
				window: rateLimitInterval,
				onExceeded: "delay",
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
	static live = Layer.effect(SheetsClient, SheetsClient.make);
}

interface SheetsOptions {
	readonly spreadsheetId: string;
	readonly sheetName: string;
}

export class AppendRow extends Context.Service<AppendRow>()(
	"smaug/googleapi/sheets/AppendRow",
	{
		make: Effect.fn(function* (initialBaseline: number) {
			const spread = 5;
			const baselineMap = new Map<string, number>();
			const sheets = yield* Google.Sheets.SheetsClient;
			const semaphore = yield* Semaphore.make(1);

			function getFirstEmptyInRange(
				rows: ReadonlyArray<ReadonlyArray<CellValue>>,
				startRow: number,
				expectedCount: number,
			) {
				if (rows.length < expectedCount) {
					return startRow + rows.length;
				}

				return null;
			}

			interface FindEmptyRowOptions extends SheetsOptions {
				readonly startColumn?: string;
				readonly endColumn?: string;
			}
			/**
			 * This function assumes sheet table is continous - we could travers the whole table from the start to find the actual first empty row but that would be terribly inefficient. So this is a nice tradeoff imo
			 */
			const findNextEmptyRow = Effect.fn("appendRow.findNextEmptyRow")(
				function* ({
					spreadsheetId,
					sheetName,
					startColumn = "A",
					endColumn = startColumn,
				}: FindEmptyRowOptions) {
					/** Lowest possible guess */
					let lower = 1;
					/** Larget possible guess */
					let upper: number | null = null;

					const key = `${spreadsheetId}:${sheetName}:${startColumn}:${endColumn}`;
					let baseline = Math.max(
						lower,
						baselineMap.get(key) ?? initialBaseline,
					);

					function updateBaseline(value: number) {
						baseline = value;
						baselineMap.set(key, value);
					}

					while (true) {
						const startRow = Math.max(baseline - spread, lower);
						const endRow = Math.min(
							baseline + spread,
							upper ?? Number.POSITIVE_INFINITY,
						);

						if (startRow === endRow) {
							updateBaseline(startRow);
							return startRow;
						}

						const rows = yield* readRange({
							spreadsheetId,
							sheetName,
							startRow,
							endRow,
							startColumn,
							endColumn,
						});

						const firstEmpty = getFirstEmptyInRange(
							rows,
							startRow,
							endRow - startRow + 1,
						);

						if (firstEmpty === null) {
							lower = endRow + 1;
							updateBaseline(
								upper === null ? lower * 2 : Math.floor((lower + upper) / 2),
							);
							continue;
						}

						if (firstEmpty !== startRow) {
							updateBaseline(firstEmpty);
							return firstEmpty;
						}

						upper = firstEmpty;
						updateBaseline(Math.floor((lower + upper) / 2));
					}
				},
			);

			const append = Effect.fn("appendRow.append")(
				function* (
					values: ReadonlyArray<CellValue>,
					options: AppendRowOptions,
				) {
					const {
						valueInputOption = ValueInputOptions.userEntered,
						startColumn = "A",
						endColumn = indexToColumn(
							columnToIndex(startColumn) + values.length - 1,
						),
						insertDataOption = InsertDataOption.insert,
					} = options;

					const row = yield* findNextEmptyRow({
						spreadsheetId: options.spreadsheetId,
						sheetName: options.sheetName,
						startColumn,
						endColumn,
					});

					const range = makeRange({
						sheetName: options.sheetName,
						startColumn: startColumn,
						endColumn,
						startRow: row,
						endRow: row,
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
									err,
								),
							),
						);
				},
				semaphore.withPermits(1),
				Effect.provideService(Google.Sheets.SheetsClient, sheets),
			);

			return {
				append,
			};
		}),
	},
) {
	static live = flow(AppendRow.make, Layer.effect(AppendRow));
}

export type CellValue = string | number | boolean | null;

export enum ValueInputOptions {
	raw = "RAW",
	userEntered = "USER_ENTERED",
}

export enum Dimension {
	rows = "ROWS",
	columns = "COLUMNS",
}

interface ReadOptions extends SheetsOptions {
	readonly startColumn?: string;
	readonly endColumn?: string;
}
interface ReadRangeOptions extends ReadOptions {
	readonly startRow: number;
	readonly endRow: number;
}

export const readRange = Effect.fn("sheets.readRange")(function* (
	options: ReadRangeOptions,
) {
	const sheets = yield* SheetsClient;
	const startColumn = options.startColumn ?? "A";
	const endColumn = options.endColumn ?? startColumn;

	const range = makeRange({
		sheetName: options.sheetName,
		startColumn,
		endColumn,
		startRow: options.startRow,
		endRow: options.endRow,
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

	const out: Array<Array<CellValue>> = response.data.values ?? [];
	return out;
});

interface ReadRowOptions extends ReadOptions {
	readonly row: number;
}

export const readRow = Effect.fn("sheets.readRow")(function* (
	options: ReadRowOptions,
) {
	const [values] = yield* readRange({
		...options,
		startRow: options.row,
		endRow: options.row,
	});
	return values ?? [];
});

export enum InsertDataOption {
	overwrite = "OVERWRITE",
	insert = "INSERT_ROWS",
}

interface WriteOptions extends SheetsOptions {
	readonly startColumn?: string;
	readonly endColumn?: string;
	readonly valueInputOption?: ValueInputOptions;
}
interface AppendRowOptions extends WriteOptions {
	insertDataOption?: InsertDataOption;
}

export const appendRow = Effect.fn("sheets.appendRow")(function* (
	values: ReadonlyArray<CellValue>,
	options: AppendRowOptions,
) {
	const appender = yield* AppendRow;
	yield* appender.append(values, options);
});

export interface WriteRowOptions extends WriteOptions {
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
				SheetsWriteError.fail(`Failed to write to row ${options.row}`, err),
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
			if (!Arr.isArrayNonEmpty(before)) {
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
		return Effect.fail(new SheetsWriteError({ message, cause }));
	}
}

const RetrySchedule = Schedule.max([
	Schedule.exponential(Duration.seconds(1)),
	Schedule.recurs(5),
]).pipe(
	Schedule.jittered,
	Schedule.tap(({ input }) =>
		Effect.logWarning(`Retrying Google Sheets request`, input),
	),
);
