import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { gmail_v1 } from "googleapis";
import { google } from "googleapis";
import { OauthClient } from "./oauth";

export class GmailError extends Data.TaggedError("GmailError")<{
	cause: unknown;
}> {}

export class GmailClient extends Effect.Service<GmailClient>()(
	"smaug/googleapi/gmail/GmailClient",
	{
		effect: Effect.gen(function* () {
			const oauth = yield* OauthClient;
			const client = yield* oauth.use((auth) =>
				google.gmail({ version: "v1", auth }),
			);

			const use = Effect.fn("gmail.use")(
				<T>(run: (client: gmail_v1.Gmail) => T | Promise<T>) =>
					Effect.tryPromise({
						async try() {
							return run(client);
						},
						catch(error) {
							return new GmailError({ cause: error });
						},
					}),
			);

			return {
				use,
			};
		}),
	},
) {
	static live = GmailClient.Default.pipe(Layer.provide(OauthClient.Default));
}

export namespace Query {
	interface And {
		readonly _tag: "And";
		readonly a: Query;
		readonly b: Query;
	}
	interface Or {
		readonly _tag: "Or";
		readonly a: Query;
		readonly b: Query;
	}
	interface Not {
		readonly _tag: "Not";
		readonly q: Query;
	}
	interface From {
		readonly _tag: "From";
		readonly email: string;
	}
	interface Subject {
		readonly _tag: "Subject";
		readonly subject: string;
	}
	interface Content {
		readonly _tag: "Content";
		readonly content: string;
	}
	interface ExactContent {
		readonly _tag: "ExactContent";
		readonly content: string;
	}
	interface Label {
		readonly _tag: "Label";
		readonly label: string;
	}
	interface After {
		readonly _tag: "After";
		readonly timestamp: DateTime.DateTime;
	}
	interface Before {
		readonly _tag: "Before";
		readonly timestamp: DateTime.DateTime;
	}
	export type Query =
		| And
		| Or
		| Not
		| From
		| Subject
		| Content
		| ExactContent
		| Label
		| After
		| Before;

	export function and(a: Query, b: Query): Query {
		return { _tag: "And", a, b };
	}
	export function or(a: Query, b: Query): Query {
		return { _tag: "Or", a, b };
	}
	export function not(q: Query): Query {
		return { _tag: "Not", q };
	}

	export function from(email: string): Query {
		return { _tag: "From", email };
	}
	export function subject(subject: string): Query {
		return { _tag: "Subject", subject };
	}
	export function content(content: string): Query {
		return { _tag: "Content", content };
	}
	export function exactContent(content: string): Query {
		return { _tag: "ExactContent", content };
	}
	export function label(label: string): Query {
		return { _tag: "Label", label };
	}

	export function after(timestamp: DateTime.DateTime): Query {
		return { _tag: "After", timestamp };
	}
	export function before(timestamp: DateTime.DateTime): Query {
		return { _tag: "Before", timestamp };
	}

	export function group(...data: ReadonlyArray<string>): string {
		return `(${data.join(" ")})`;
	}

	const api = {
		and,
		or,
		not,
		from,
		subject,
		content,
		exactContent,
		label,
		after,
		before,
		group,
	} as const;

	export function build(create: (ctx: typeof api) => Query) {
		return create(api);
	}

	/**
	 * Serializes a query structure into a Gmail query string.
	 */
	export function serialize(query: Query): string {
		switch (query._tag) {
			case "And":
				return group(serialize(query.a), "AND", serialize(query.b));
			case "Or":
				return group(serialize(query.a), "OR", serialize(query.b));
			case "Not":
				return `-${serialize(query.q)}`;
			case "From":
				return `from:${query.email}`;
			case "Subject":
				return `subject:${query.subject}`;
			case "Content":
				return query.content;
			case "ExactContent":
				return quoteValue(query.content);
			case "Label":
				return `label:${query.label}`;
			case "After":
				return `after:${formatDate(query.timestamp)}`;
			case "Before":
				return `before:${formatDate(query.timestamp)}`;
		}
	}

	function quoteValue(value: string): string {
		return `"${value.replaceAll('"', '\\"')}"`;
	}
	function formatDate(timestamp: DateTime.DateTime): string {
		return DateTime.formatIsoDateUtc(timestamp).replaceAll("-", "/");
	}
}
