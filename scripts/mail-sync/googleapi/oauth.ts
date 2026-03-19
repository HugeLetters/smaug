import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { type Auth, google } from "googleapis";

export class OauthError extends Data.TaggedError("OauthError")<{
	cause: unknown;
}> {}

export class OauthClient extends Effect.Service<OauthClient>()(
	"smaug/googleapi/oauth/OauthClient",
	{
		effect: Effect.fn(function* (
			clientId: string,
			clientSecret: Redacted.Redacted<string>,
		) {
			const client = new google.auth.OAuth2({
				client_id: clientId,
				client_secret: Redacted.value(clientSecret),
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

			return {
				use,
				raw: client,
			};
		}),
	},
) {
	static live = OauthClient.Default;
}

export const GetCredentials = OauthClient.use(
	(client) => client.raw.credentials,
);

export const updateCredentials = Effect.fn("oauth.update_credentials")(
	function* (update: Partial<Auth.Credentials>) {
		const client = yield* OauthClient;
		const current = yield* GetCredentials;
		client.raw.setCredentials({ ...current, ...update });
	},
);

export enum Scope {
	GmailModify = "https://www.googleapis.com/auth/gmail.modify",
	GmailRead = "https://www.googleapis.com/auth/gmail.readonly",
	SheetsWrite = "https://www.googleapis.com/auth/spreadsheets",
}
