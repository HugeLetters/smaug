import * as Command from "@effect/platform/Command";
import * as HttpServer from "@effect/platform/HttpServer";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { CodeChallengeMethod } from "google-auth-library";
import { Secrets } from "~/server/lib/utils/secrets";
import { Google } from "./googleapi";

const RequiredScopes = [
	Google.Oauth.Scope.GmailModify,
	Google.Oauth.Scope.GmailRead,
	Google.Oauth.Scope.SheetsWrite,
];

export const SetupAuth = Effect.gen(function* () {
	const oauth = yield* Google.Oauth.OauthClient;

	const isClientAccessValid = yield* oauth.GetCredentials.pipe(
		Effect.map((c) => c.access_token ?? null),
		Effect.flatMap((token) => {
			if (token === null) {
				return Effect.succeed(false);
			}

			return checkTokenPermission(token);
		}),
	);

	if (isClientAccessValid) {
		const refreshToken = yield* oauth.GetCredentials.pipe(
			Effect.map((c) => c.refresh_token ?? null),
		);
		if (refreshToken !== null) {
			yield* RefreshSecret.set(refreshToken);
		}

		return;
	}

	const clientRefreshToken = yield* oauth.GetCredentials.pipe(
		Effect.map((c) => c.refresh_token ?? null),
	);
	if (clientRefreshToken !== null) {
		const refreshedToken = yield* refreshAccessToken(clientRefreshToken);
		if (refreshedToken !== null) {
			yield* RefreshSecret.set(clientRefreshToken);
			return;
		}
	}

	const storedRefreshToken = yield* RefreshSecret.Get;
	if (storedRefreshToken !== null) {
		const refreshedToken = yield* refreshAccessToken(
			Redacted.value(storedRefreshToken),
		);
		if (refreshedToken !== null) {
			return;
		}
	}

	yield* RegenerateCredentials;
});

const checkTokenPermission = Effect.fn(function* (token: string) {
	const oauth = yield* Google.Oauth.OauthClient;

	const info = yield* oauth
		.use((c) => c.getTokenInfo(token))
		.pipe(Effect.catchTag("OauthError", () => Effect.succeed(null)));

	if (info === null) {
		return false;
	}

	return areScopesSufficient(info.scopes);
});

const areScopesSufficient = (scopes: ReadonlyArray<string>) =>
	Arr.difference(RequiredScopes, scopes).length === 0;

const GetAccessToken = Effect.gen(function* () {
	const oauth = yield* Google.Oauth.OauthClient;
	const token = yield* oauth.GetCredentials.pipe(
		Effect.map((c) => c.access_token ?? null),
	);
	if (token !== null) {
		return token;
	}

	const res = yield* oauth
		.use((c) => c.getAccessToken())
		.pipe(Effect.catchTag("OauthError", () => Effect.succeed(null)));
	const refreshed = res?.token;
	if (!refreshed) {
		return null;
	}

	yield* oauth.updateCredentials({ access_token: refreshed });
	return refreshed;
});

const refreshAccessToken = Effect.fn(function* (refreshToken: string) {
	const oauth = yield* Google.Oauth.OauthClient;

	yield* oauth.updateCredentials({ refresh_token: refreshToken });

	const token = yield* GetAccessToken;
	if (token === null) {
		return null;
	}

	const isValidToken = yield* checkTokenPermission(token);
	if (!isValidToken) {
		return null;
	}

	return token;
});

interface OAuthCallbackPayload {
	code: string | null;
	error: string | null;
	errorDescription: string | null;
	state: string | null;
}

const RegenerateCredentials = Effect.gen(function* () {
	const oauth = yield* Google.Oauth.OauthClient;
	const state = crypto.randomUUID();

	const pkce = yield* oauth.use((client) => client.generateCodeVerifierAsync());

	const { payload, redirectUri } = yield* getOauth2Payload(
		pkce.codeChallenge,
		state,
	);

	if (payload.state !== state) {
		return yield* AuthError.fail("OAuth callback state mismatch");
	}

	if (payload.error !== null) {
		return yield* AuthError.fail(payload.errorDescription ?? payload.error);
	}

	const code = payload.code;
	if (code === null) {
		return yield* AuthError.fail("OAuth callback missing authorization code");
	}

	const tokenResponse = yield* oauth.use((client) =>
		client.getToken({
			code,
			codeVerifier: pkce.codeVerifier,
			redirect_uri: redirectUri,
		}),
	);

	const accessToken = tokenResponse.tokens.access_token;
	const refreshToken = tokenResponse.tokens.refresh_token;

	if (accessToken == null || refreshToken == null) {
		return yield* AuthError.fail(
			"OAuth token response missing access or refresh token",
		);
	}

	yield* RefreshSecret.set(refreshToken);
	yield* oauth.use((c) => c.setCredentials(tokenResponse.tokens));

	yield* Effect.log("Google refresh token regenerated successfully");
});

const getOauth2Payload = Effect.fn(function* (
	challenge: string | undefined,
	state: string,
) {
	const oauth = yield* Google.Oauth.OauthClient;
	const payloadDeferred = yield* Deferred.make<OAuthCallbackPayload>();

	const server = yield* BunHttpServer.make({ port: 0 });

	yield* server.serve(
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			const url = new URL(request.originalUrl);

			yield* Deferred.succeed(payloadDeferred, {
				code: url.searchParams.get("code"),
				error: url.searchParams.get("error"),
				errorDescription: url.searchParams.get("error_description"),
				state: url.searchParams.get("state"),
			});

			return HttpServerResponse.text(
				"Authentication complete. Return to the terminal.",
			);
		}),
	);

	const redirectUri = HttpServer.formatAddress(server.address);

	const authUrl = yield* oauth.use((client) =>
		client.generateAuthUrl({
			access_type: "offline",
			code_challenge: challenge,
			code_challenge_method: CodeChallengeMethod.S256,
			include_granted_scopes: true,
			prompt: "consent",
			redirect_uri: redirectUri,
			scope: RequiredScopes,
			state,
		}),
	);

	const waitingDuration = Duration.minutes(5);

	yield* Effect.log(
		`Use this url to authenticate google. You have ${Duration.format(waitingDuration)}`,
		authUrl,
	);

	const browserExitCode = yield* Command.exitCode(
		Command.make("open", authUrl).pipe(
			Command.stderr("inherit"),
			Command.stdout("inherit"),
		),
	);

	if (browserExitCode !== 0) {
		yield* Effect.logWarning(
			"Could not open browser automatically, open the URL manually",
		);
	}

	const payload = yield* Deferred.await(payloadDeferred).pipe(
		Effect.timeoutFail({
			duration: waitingDuration,
			onTimeout() {
				return AuthError.fail("Timed out waiting for OAuth callback");
			},
		}),
	);

	return { payload, redirectUri };
}, Effect.scoped);

export class AuthError extends Data.TaggedError("AuthError")<{
	message: string;
	cause?: unknown;
}> {
	static fail(message: string, cause?: unknown) {
		return new AuthError({ message, cause });
	}
}

const RefreshSecret = Secrets.forKey("google_refresh_token");
