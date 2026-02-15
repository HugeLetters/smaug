import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { BankParser, Email, ParserError, Transaction } from "./types";

const parsers = new Map<string, BankParser>();

export const registerParser = (parser: BankParser): void => {
	parsers.set(parser.name, parser);
};

export const findParser = (_email: Email): Option.Option<BankParser> => {
	for (const parser of parsers.values()) {
		return Option.some(parser);
	}
	return Option.none();
};

export const extractTextFromHtml = (html: string): string => {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
};

export const extractAmount = (text: string): Option.Option<number> => {
	const patterns = [
		/\$[\d,]+\.?\d*/,
		/amount[\s:]+[\d,]+\.?\d*/i,
		/purchase[\s:]+[\d,]+\.?\d*/i,
		/charge[\s:]+[\d,]+\.?\d*/i,
		/paid[\s:]+[\d,]+\.?\d*/i,
		/total[\s:]+[\d,]+\.?\d*/i,
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) {
			const amount = Number.parseFloat(match[0].replace(/[$,]/g, ""));
			if (!Number.isNaN(amount)) {
				return Option.some(amount);
			}
		}
	}

	return Option.none();
};

export const extractDate = (text: string): Option.Option<Date> => {
	const patterns = [
		/(\d{1,2}\/\d{1,2}\/\d{2,4})/,
		/(\d{1,2}-\d{1,2}-\d{2,4})/,
		/(\d{4}-\d{2}-\d{2})/,
		/(?:on|date)[\s:]+(\w+\s+\d{1,2},?\s+\d{4})/i,
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) {
			const date = new Date(match[1] as string);
			if (!Number.isNaN(date.getTime())) {
				return Option.some(date);
			}
		}
	}

	return Option.some(new Date());
};

export const extractMerchant = (text: string): Option.Option<string> => {
	const patterns = [
		/at\s+([^.]+?)(?:\.|\s+for|$)/i,
		/merchant[\s:]+([^.]+?)(?:\.|\s+for|$)/i,
		/payee[\s:]+([^.]+?)(?:\.|\s+for|$)/i,
		/to\s+([^.]+?)(?:\.|\s+for|$)/i,
		/from\s+([^.]+?)(?:\.|\s+for|$)/i,
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) {
			const merchant = (match[1] as string).trim();
			if (merchant.length > 0) {
				return Option.some(merchant);
			}
		}
	}

	return Option.some("Unknown Merchant");
};

export const parseEmail = (
	email: Email,
	_accountEmail: string,
): Effect.Effect<Option.Option<Transaction>, ParserError> =>
	Effect.gen(function* () {
		yield* Effect.log(`Parsing email: ${email.id}`);

		const parser = findParser(email);

		if (Option.isNone(parser)) {
			yield* Effect.log("No parser found for email");
			return Option.none();
		}

		const parsed = yield* parser.value.parse(email);
		return parsed;
	});

export const ChaseParser: BankParser = {
	name: "Chase",
	parse: (email: Email) =>
		Effect.gen(function* () {
			yield* Effect.log("Attempting to parse with Chase parser");

			const text = email.snippet.toLowerCase();

			if (!text.includes("chase") && !text.includes("credit card")) {
				return Option.none();
			}

			const amount = extractAmount(email.snippet);
			const merchant = extractMerchant(email.snippet);
			const date = extractDate(email.snippet);

			if (Option.isNone(amount) || Option.isNone(merchant)) {
				return Option.none();
			}

			return Option.some({
				id: crypto.randomUUID(),
				date: Option.getOrElse(date, () => new Date()),
				amount: amount.value,
				currency: "USD",
				merchant: merchant.value,
				account: "",
				bankName: "Chase",
				rawEmailId: email.id,
				rawSnippet: email.snippet,
			});
		}),
};

export const BankOfAmericaParser: BankParser = {
	name: "Bank of America",
	parse: (email: Email) =>
		Effect.gen(function* () {
			yield* Effect.log("Attempting to parse with Bank of America parser");

			const text = email.snippet.toLowerCase();

			if (
				!text.includes("bank of america") &&
				!text.includes("boa") &&
				!text.includes("debit card")
			) {
				return Option.none();
			}

			const amount = extractAmount(email.snippet);
			const merchant = extractMerchant(email.snippet);
			const date = extractDate(email.snippet);

			if (Option.isNone(amount) || Option.isNone(merchant)) {
				return Option.none();
			}

			return Option.some({
				id: crypto.randomUUID(),
				date: Option.getOrElse(date, () => new Date()),
				amount: amount.value,
				currency: "USD",
				merchant: merchant.value,
				account: "",
				bankName: "Bank of America",
				rawEmailId: email.id,
				rawSnippet: email.snippet,
			});
		}),
};

export const GenericParser: BankParser = {
	name: "Generic",
	parse: (email: Email) =>
		Effect.gen(function* () {
			yield* Effect.log("Attempting to parse with Generic parser");

			const amount = extractAmount(email.snippet);
			const merchant = extractMerchant(email.snippet);
			const date = extractDate(email.snippet);

			if (Option.isNone(amount) || Option.isNone(merchant)) {
				return Option.none();
			}

			return Option.some({
				id: crypto.randomUUID(),
				date: Option.getOrElse(date, () => new Date()),
				amount: amount.value,
				currency: "USD",
				merchant: merchant.value,
				account: "",
				bankName: "Unknown",
				rawEmailId: email.id,
				rawSnippet: email.snippet,
			});
		}),
};

registerParser(ChaseParser);
registerParser(BankOfAmericaParser);
registerParser(GenericParser);
