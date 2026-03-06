import { pipe, type Types } from "effect";
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import type { Mutable } from "effect/Types";
import type { gmail_v1 } from "googleapis";
import { AppConfig } from "./config";
import { Google } from "./googleapi";

const ME = "me";

export const SetupMail = Effect.gen(function* () {
	const config = yield* AppConfig;

	yield* Effect.all(
		[
			ensureLabel({
				name: config.mail.labelName,
				bg: "#16a765",
				text: "#ffffff",
			}),
			ensureLabel({
				name: config.mail.failedLabelName,
				bg: "#89d3b2",
				text: "#ffffff",
			}),
		],
		{ concurrency: "unbounded" },
	);
});

export const ProcessMailBatch = Effect.gen(function* () {
	const m = yield* getUnprocessedEmails(null);
	yield* Effect.log(m.map((m) => m.snippet.trim()));
});

interface Label {
	readonly name: string;
	readonly bg: ValidLabelColor;
	readonly text: ValidLabelColor;
}

const ensureLabel = Effect.fn(function* (label: Label) {
	const gmail = yield* Google.Gmail.GmailClient;

	const foundLabel = yield* gmail
		.use((client) => client.users.labels.list({ userId: ME }))
		.pipe(
			Effect.map((res) => res.data.labels ?? []),
			Effect.map((res) => res.find((result) => result.name === label.name)),
		);

	if (foundLabel) {
		// TODO gmail-sync | sync label config - bg/text if gmail data doesnt match | by Evgenii Perminov at Fri, 27 Feb 2026 02:00:46 GMT
		const foundId = foundLabel.id;
		if (!foundId) {
			return yield* MailError.fail("Found Label does not have an ID attached");
		}

		return foundId;
	}

	const createdLabel = yield* gmail.use((client) =>
		client.users.labels.create({
			userId: ME,
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
	);

	const createdId = createdLabel.data.id;
	if (!createdId) {
		return yield* MailError.fail(
			`Created label but no ID returned: ${label.name}`,
		);
	}

	return createdId;
});

interface Email {
	readonly id: string;
	readonly snippet: string;
	readonly content: Content;
}

const getUnprocessedEmails = Effect.fn("fetchUnprocessedEmails")(function* (
	query: Google.Gmail.Query.Query | null,
) {
	const config = yield* AppConfig;
	const finalQuery = Google.Gmail.Query.build((q) => {
		const AfterStart = q.after(config.mail.startDate);
		const NotProcessed = q.not(q.label(config.mail.labelName));
		const NotFailedToProcess = q.not(q.label(config.mail.failedLabelName));

		const baseQuery = pipe(
			AfterStart,
			(_) => q.and(_, NotProcessed),
			(_) => q.and(_, NotFailedToProcess),
		);

		if (query === null) {
			return baseQuery;
		}

		return q.and(baseQuery, query);
	});

	const gmail = yield* Google.Gmail.GmailClient;

	const response = yield* gmail.use((client) =>
		client.users.messages.list({
			userId: ME,
			q: Google.Gmail.Query.serialize(finalQuery),
			maxResults: 10,
		}),
	);

	return yield* pipe(
		response.data.messages ?? [],
		Effect.forEach(
			Effect.fnUntraced(function* (message) {
				const id = message.id;
				if (!id) {
					return;
				}

				const fullMessage = yield* gmail.use((client) =>
					client.users.messages.get({
						userId: ME,
						id,
						format: "full",
					}),
				);

				const content = extractEmailContentMaybe(
					fullMessage.data.payload ?? null,
				);
				const email: Email = {
					id,
					snippet: fullMessage.data.snippet ?? "",
					content,
				};

				return email;
			}),
		),
		Effect.map(Arr.filter((v) => v !== undefined)),
	);
});

const applyLabel = Effect.fn("applyLabel")(function* (
	emailId: string,
	labelId: string,
) {
	const gmail = yield* Google.Gmail.GmailClient;

	yield* gmail.use((client) =>
		client.users.messages.modify({
			userId: ME,
			id: emailId,
			requestBody: {
				addLabelIds: [labelId],
			},
		}),
	);
});

interface Content {
	readonly plain: string | null;
	readonly html: string | null;
}

function extractEmailContent(payload: gmail_v1.Schema$MessagePart): Content {
	if (payload.mimeType === "text/html" && payload.body?.data) {
		return {
			html: decodeBase64(payload.body.data),
			plain: null,
		};
	}

	if (payload.mimeType === "text/plain" && payload.body?.data) {
		return {
			plain: decodeBase64(payload.body.data),
			html: null,
		};
	}

	if (payload.parts) {
		return pipe(
			payload.parts,
			Arr.map(extractEmailContent),
			Arr.reduce({ html: null, plain: null }, (result, part): Content => {
				return {
					html: concatMaybe(result.html, part.html),
					plain: concatMaybe(result.plain, part.plain),
				};
			}),
		);
	}

	return {
		html: null,
		plain: null,
	};
}

function extractEmailContentMaybe(
	payload: gmail_v1.Schema$MessagePart | null,
): Content {
	if (!payload) {
		return { html: null, plain: null };
	}

	return extractEmailContent(payload);
}

function concatMaybe(a: string | null, b: string | null) {
	return Match.value([a, b]).pipe(
		Match.when([Match.string, null], ([a, _]) => a),
		Match.when([null, Match.string], ([_, b]) => b),
		Match.when([Match.string, Match.string], ([a, b]) => `${a}${b}`),
		Match.when([null, null], () => null),
		Match.exhaustive,
	);
}

function decodeBase64(base64: string) {
	return Buffer.from(base64, "base64").toString("utf-8");
}

export class MailError extends Data.TaggedError("MailError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {
	static fail(message: string, cause?: unknown) {
		return new MailError({ message, cause });
	}
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
