import { FileSystem } from "@effect/platform/FileSystem";
import { Path } from "@effect/platform/Path";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import {
	type Config,
	ConfigError,
	ConfigSchema,
	type GmailAccount,
} from "./types";

const CONFIG_SECRET_KEY = "gmail-sync-config";

export const loadConfig = Effect.fn("loadConfig")(function* () {
	yield* Effect.log("Loading configuration from Bun.secrets");

	const fs = yield* FileSystem;
	const path = yield* Path;
	const configPath = path.join(
		process.cwd(),
		".secrets",
		`${CONFIG_SECRET_KEY}.json`,
	);

	const configExists = yield* fs.exists(configPath);
	if (!configExists) {
		return yield* Effect.fail(
			new ConfigError({
				message: `Configuration not found at ${configPath}. Run the config setup script first.`,
			}),
		);
	}

	const configContent = yield* fs.readFileString(configPath);
	const jsonConfig = yield* Effect.try({
		try: () => JSON.parse(configContent) as unknown,
		catch: (error) =>
			new ConfigError({
				message: "Failed to parse config JSON",
				cause: error,
			}),
	});

	const decoded = yield* Schema.decodeUnknown(ConfigSchema)(jsonConfig).pipe(
		Effect.mapError(
			(error) =>
				new ConfigError({
					message: `Configuration validation failed: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
					cause: error,
				}),
		),
	);

	yield* Effect.log(
		`Loaded configuration with ${decoded.accounts.length} accounts`,
	);
	return decoded;
});

export const saveConfig = Effect.fn("saveConfig")(function* (config: Config) {
	yield* Effect.log("Saving configuration to Bun.secrets");

	const fs = yield* FileSystem;
	const path = yield* Path;
	const configPath = path.join(
		process.cwd(),
		".secrets",
		`${CONFIG_SECRET_KEY}.json`,
	);

	yield* fs.makeDirectory(path.dirname(configPath), { recursive: true });

	const encoded = yield* Schema.encode(ConfigSchema)(config).pipe(
		Effect.mapError(
			(error) =>
				new ConfigError({
					message: `Failed to encode config: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
					cause: error,
				}),
		),
	);

	const configJson = JSON.stringify(encoded, null, 2);
	yield* fs.writeFileString(configPath, configJson);

	yield* Effect.log(`Configuration saved to ${configPath}`);
});

export const validateCredentials = Effect.fn("validateCredentials")(function* (
	account: GmailAccount,
) {
	const fs = yield* FileSystem;

	const credentialsExist = yield* fs.exists(account.credentialsPath);
	if (!credentialsExist) {
		return yield* Effect.fail(
			new ConfigError({
				message: `Credentials file not found: ${account.credentialsPath}`,
			}),
		);
	}

	const credentialsContent = yield* fs.readFileString(account.credentialsPath);
	const credentials = yield* Effect.try({
		try: () => JSON.parse(credentialsContent) as unknown,
		catch: (error) =>
			new ConfigError({
				message: `Failed to parse credentials for ${account.email}`,
				cause: error,
			}),
	});

	const hasRequiredFields =
		credentials &&
		typeof credentials === "object" &&
		"installed" in credentials &&
		credentials.installed &&
		typeof credentials.installed === "object" &&
		"client_id" in credentials.installed &&
		"client_secret" in credentials.installed;

	if (!hasRequiredFields) {
		return yield* Effect.fail(
			new ConfigError({
				message: `Invalid credentials format for ${account.email}. Missing required OAuth fields.`,
			}),
		);
	}

	yield* Effect.log(`Validated credentials for ${account.email}`);
});

export const loadCredentials = Effect.fn("loadCredentials")(function* (
	account: GmailAccount,
) {
	const fs = yield* FileSystem;

	const credentialsContent = yield* fs.readFileString(account.credentialsPath);
	const credentials = yield* Effect.try({
		try: () =>
			JSON.parse(credentialsContent) as {
				installed: {
					client_id: string;
					client_secret: string;
					redirect_uris: string[];
				};
			},
		catch: (error) =>
			new ConfigError({
				message: `Failed to parse credentials for ${account.email}`,
				cause: error,
			}),
	});

	return {
		clientId: credentials.installed.client_id,
		clientSecret: credentials.installed.client_secret,
		redirectUris: credentials.installed.redirect_uris,
	};
});

export const loadToken = Effect.fn("loadToken")(function* (
	account: GmailAccount,
) {
	const fs = yield* FileSystem;

	const tokenExists = yield* fs.exists(account.tokenPath);
	if (!tokenExists) {
		return Option.none();
	}

	const tokenContent = yield* fs.readFileString(account.tokenPath);
	const token = yield* Effect.try({
		try: () =>
			JSON.parse(tokenContent) as {
				access_token: string;
				refresh_token: string;
				expiry_date: number;
			},
		catch: (error) =>
			new ConfigError({
				message: `Failed to parse token for ${account.email}`,
				cause: error,
			}),
	});

	return Option.some(token);
});

export const saveToken = Effect.fn("saveToken")(function* (
	account: GmailAccount,
	token: { access_token: string; refresh_token?: string; expiry_date?: number },
) {
	const fs = yield* FileSystem;
	const path = yield* Path;

	yield* fs.makeDirectory(path.dirname(account.tokenPath), {
		recursive: true,
	});

	const tokenJson = JSON.stringify(token, null, 2);
	yield* fs.writeFileString(account.tokenPath, tokenJson);

	yield* Effect.log(`Token saved for ${account.email}`);
});
