import * as Data from "effect/Data";
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
