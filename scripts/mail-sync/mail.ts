import { pipe } from "effect";
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import type { gmail_v1 } from "googleapis";
import { Google } from "./googleapi";

const ME = "me";

export class MailConfig extends Effect.Service<MailConfig>()(
	"smaug/mail-sync/MailConfig",
	{
		effect: Effect.fn(function* (config: { labelName: string }) {
			// const labelId = yield* ensureLabel(config.labelName);
			return {
				labelName: config.labelName,
				labelId: "",
			};
		}),
	},
) {}

interface Label {
	readonly name: string;
	readonly bg: NonNullable<gmail_v1.Schema$LabelColor["backgroundColor"]>;
	readonly text: NonNullable<gmail_v1.Schema$LabelColor["textColor"]>;
}

// TODO gmail-sync | i dont want to fetch this every time we process a mail | by Evgenii Perminov at Thu, 26 Feb 2026 22:24:13 GMT
export const ensureLabel = Effect.fn("getOrCreateLabel")(function* (
	label: Label,
) {
	const gmail = yield* Google.Gmail.GmailClient;

	const foundLabel = yield* gmail
		.use((client) => client.users.labels.list({ userId: ME }))
		.pipe(
			Effect.map((res) => res.data.labels ?? []),
			Effect.map((res) => res.find((result) => result.name === label.name)),
		);

	if (foundLabel) {
		console.log(foundLabel);
		// TODO gmail-sync | sync label config | by Evgenii Perminov at Fri, 27 Feb 2026 02:00:46 GMT
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

export const getUnprocessedEmails = Effect.fn("fetchUnprocessedEmails")(
	function* (labelId: string) {
		// TODO gmail-sync | bank filter + from date | by Evgenii Perminov at Thu, 26 Feb 2026 22:28:58 GMT
		// const query = Google.Gmail.Query.not(Google.Gmail.Query.label(labelId));
		const query = Google.Gmail.Query.build((q) => {
			return q.not(q.label(labelId));
		});

		yield* Effect.log(Google.Gmail.Query.serialize(query));

		const gmail = yield* Google.Gmail.GmailClient;

		const response = yield* gmail.use((client) =>
			client.users.messages.list({
				userId: ME,
				q: Google.Gmail.Query.serialize(query),
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

					return {
						id,
						snippet: fullMessage.data.snippet ?? "",
						payload: extractEmailContentMaybe(fullMessage.data.payload ?? null),
					};
				}),
			),
			Effect.map(Arr.filter((v) => v !== undefined)),
		);
	},
);

export const applyLabel = Effect.fn("applyLabel")(function* (
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

export const getEmailContent = Effect.fn("getEmailContent")(function* (
	emailId: string,
) {
	const gmail = yield* Google.Gmail.GmailClient;

	const message = yield* gmail.use((client) =>
		client.users.messages.get({
			// TODO gmail-sync | why do I need userId? | by Evgenii Perminov at Thu, 26 Feb 2026 22:54:26 GMT
			userId: ME,
			id: emailId,
			format: "full",
		}),
	);

	const payload = message.data.payload;
	if (!payload) {
		return "";
	}

	const text = extractEmailContent(payload);
	return text;
});

interface EmailContent {
	readonly plain: string | null;
	readonly html: string | null;
}

function extractEmailContent(
	payload: gmail_v1.Schema$MessagePart,
): EmailContent {
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
			Arr.reduce({ html: null, plain: null }, (result, part): EmailContent => {
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
): EmailContent {
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

export function decodeBase64(base64: string) {
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
