import * as Config from "effect/Config";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { type Auth, google } from "googleapis";
import { Secrets } from "~/server/lib/utils/secrets";

export class OauthError extends Data.TaggedError("OauthError")<{
	cause: unknown;
}> {}

const OauthConfig = Effect.gen(function* () {
	const clientId = yield* Config.string("client_id");
	const clientSecret = yield* Secrets.use((s) =>
		s.getOrFail("google_client_secret"),
	);

	return {
		clientId,
		clientSecret,
	};
});

export class OauthClient extends Effect.Service<OauthClient>()(
	"smaug/googleapi/oauth/OauthClient",
	{
		effect: Effect.gen(function* () {
			const config = yield* OauthConfig;

			const client = new google.auth.OAuth2({
				client_id: config.clientId,
				client_secret: Redacted.value(config.clientSecret),
			});

			const use = Effect.fn("oauth.use")(
				<T>(run: (client: Auth.OAuth2Client) => T | Promise<T>) =>
					Effect.tryPromise({
						async try() {
							return run(client);
						},
						catch(error) {
							return new OauthError({ cause: error });
						},
					}),
			);

			const GetCredentials = Effect.sync(() => client.credentials);

			return {
				use,
				GetCredentials,
				updateCredentials(update: Partial<Auth.Credentials>) {
					return Effect.gen(function* () {
						const current = yield* GetCredentials;
						client.setCredentials({ ...current, ...update });
					});
				},
			};
		}),
	},
) {
	static live = OauthClient.Default;
}

export enum Scope {
	GmailModify = "https://www.googleapis.com/auth/gmail.modify",
	GmailRead = "https://www.googleapis.com/auth/gmail.readonly",
}
