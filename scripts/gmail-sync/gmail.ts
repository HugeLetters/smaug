import type { PlatformError } from "@effect/platform/Error";
import type { FileSystem } from "@effect/platform/FileSystem";
import type { Path } from "@effect/platform/Path";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { gmail_v1 } from "googleapis";
import { google } from "googleapis";
import { loadCredentials, loadToken, saveToken } from "./config";
import {
	type ConfigError,
	type Email,
	type GmailAccount,
	GmailSyncError,
} from "./types";

const SCOPES = [
	"https://www.googleapis.com/auth/gmail.modify",
	"https://www.googleapis.com/auth/gmail.readonly",
];

export const createGmailClient = (
	account: GmailAccount,
): Effect.Effect<
	gmail_v1.Gmail,
	GmailSyncError | PlatformError | ConfigError,
	FileSystem | Path
> =>
	Effect.gen(function* () {
		yield* Effect.log(`Creating Gmail client for ${account.email}`);

		const credentials = yield* loadCredentials(account);
		const existingToken = yield* loadToken(account);

		const oauth2Client = new google.auth.OAuth2(
			credentials.clientId,
			credentials.clientSecret,
			credentials.redirectUris[0] ?? "http://localhost",
		);

		if (Option.isSome(existingToken)) {
			const token = existingToken.value;
			oauth2Client.setCredentials({
				access_token: token.access_token,
				refresh_token: token.refresh_token,
				expiry_date: token.expiry_date,
			});
		} else {
			return yield* Effect.fail(
				new GmailSyncError({
					message: `No stored token found for ${account.email}. Run auth setup first.`,
				}),
			);
		}

		const gmail = google.gmail({ version: "v1", auth: oauth2Client });
		yield* Effect.log(`Gmail client created for ${account.email}`);

		return gmail;
	});

export const getOrCreateLabel = (
	client: gmail_v1.Gmail,
	labelName: string,
): Effect.Effect<string, GmailSyncError> =>
	Effect.gen(function* () {
		yield* Effect.log(`Getting or creating label: ${labelName}`);

		const existingLabels = yield* Effect.tryPromise({
			try: () =>
				client.users.labels.list({
					userId: "me",
				}),
			catch: (error) =>
				new GmailSyncError({
					message: "Failed to list labels",
					cause: error,
				}),
		});

		const existingLabel = existingLabels.data.labels?.find(
			(label) => label.name === labelName,
		);

		if (existingLabel?.id) {
			yield* Effect.log(`Found existing label: ${existingLabel.id}`);
			return existingLabel.id;
		}

		yield* Effect.log(`Creating new label: ${labelName}`);
		const newLabel = yield* Effect.tryPromise({
			try: () =>
				client.users.labels.create({
					userId: "me",
					requestBody: {
						name: labelName,
						labelListVisibility: "labelShow",
						messageListVisibility: "show",
					},
				}),
			catch: (error) =>
				new GmailSyncError({
					message: `Failed to create label: ${labelName}`,
					cause: error,
				}),
		});

		if (!newLabel.data.id) {
			return yield* Effect.fail(
				new GmailSyncError({
					message: `Created label but no ID returned: ${labelName}`,
				}),
			);
		}

		yield* Effect.log(`Created label: ${newLabel.data.id}`);
		return newLabel.data.id;
	});

export const fetchUnprocessedEmails = (
	client: gmail_v1.Gmail,
	labelId: string,
): Effect.Effect<Email[], GmailSyncError> =>
	Effect.gen(function* () {
		const query = `-label:${labelId} category:primary`;
		yield* Effect.log(`Fetching emails with query: ${query}`);

		const response = yield* Effect.tryPromise({
			try: () =>
				client.users.messages.list({
					userId: "me",
					q: query,
					maxResults: 50,
				}),
			catch: (error) =>
				new GmailSyncError({
					message: "Failed to fetch emails",
					cause: error,
				}),
		});

		const messages = response.data.messages ?? [];
		yield* Effect.log(`Found ${messages.length} unprocessed emails`);

		if (messages.length === 0) {
			return [];
		}

		const emails: Email[] = [];

		for (const message of messages) {
			if (!message.id) {
				continue;
			}

			const fullMessage = yield* Effect.tryPromise({
				try: () =>
					client.users.messages.get({
						userId: "me",
						id: message.id as string,
						format: "full",
					}),
				catch: (error) =>
					new GmailSyncError({
						message: `Failed to get message: ${message.id}`,
						cause: error,
					}),
			});

			emails.push({
				id: message.id as string,
				snippet: fullMessage.data.snippet ?? "",
				payload: fullMessage.data.payload,
			});
		}

		return emails;
	});

export const applyLabel = (
	client: gmail_v1.Gmail,
	emailId: string,
	labelId: string,
): Effect.Effect<void, GmailSyncError> =>
	Effect.gen(function* () {
		yield* Effect.log(`Applying label ${labelId} to email ${emailId}`);

		yield* Effect.tryPromise({
			try: () =>
				client.users.messages.modify({
					userId: "me",
					id: emailId,
					requestBody: {
						addLabelIds: [labelId],
					},
				}),
			catch: (error) =>
				new GmailSyncError({
					message: `Failed to apply label to email: ${emailId}`,
					cause: error,
				}),
		});

		yield* Effect.log(`Label applied successfully`);
	});

export const getEmailContent = (
	client: gmail_v1.Gmail,
	emailId: string,
): Effect.Effect<string, GmailSyncError> =>
	Effect.gen(function* () {
		yield* Effect.log(`Getting email content for ${emailId}`);

		const message = yield* Effect.tryPromise({
			try: () =>
				client.users.messages.get({
					userId: "me",
					id: emailId,
					format: "full",
				}),
			catch: (error) =>
				new GmailSyncError({
					message: `Failed to get email: ${emailId}`,
					cause: error,
				}),
		});

		const text = extractTextFromPayload(message.data.payload);
		return text;
	});

function extractTextFromPayload(
	payload: gmail_v1.Schema$MessagePart | undefined,
): string {
	if (!payload) {
		return "";
	}

	if (payload.mimeType === "text/plain" && payload.body?.data) {
		return Buffer.from(payload.body.data, "base64").toString("utf-8");
	}

	if (payload.mimeType === "text/html" && payload.body?.data) {
		const html = Buffer.from(payload.body.data, "base64").toString("utf-8");
		return extractTextFromHtml(html);
	}

	if (payload.parts) {
		for (const part of payload.parts) {
			const text = extractTextFromPayload(part);
			if (text) {
				return text;
			}
		}
	}

	return "";
}

function extractTextFromHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export const initiateAuth = (
	account: GmailAccount,
): Effect.Effect<
	string,
	GmailSyncError | PlatformError | ConfigError,
	FileSystem
> =>
	Effect.gen(function* () {
		yield* Effect.log(`Initiating OAuth flow for ${account.email}`);

		const credentials = yield* loadCredentials(account);

		const oauth2Client = new google.auth.OAuth2(
			credentials.clientId,
			credentials.clientSecret,
			credentials.redirectUris[0] ?? "http://localhost",
		);

		const authUrl = oauth2Client.generateAuthUrl({
			access_type: "offline",
			scope: SCOPES,
			prompt: "consent",
		});

		return authUrl;
	});

export const completeAuth = (
	account: GmailAccount,
	code: string,
): Effect.Effect<
	void,
	GmailSyncError | PlatformError | ConfigError,
	FileSystem | Path
> =>
	Effect.gen(function* () {
		yield* Effect.log(`Completing OAuth flow for ${account.email}`);

		const credentials = yield* loadCredentials(account);

		const oauth2Client = new google.auth.OAuth2(
			credentials.clientId,
			credentials.clientSecret,
			credentials.redirectUris[0] ?? "http://localhost",
		);

		const { tokens } = yield* Effect.tryPromise({
			try: () => oauth2Client.getToken(code),
			catch: (error) =>
				new GmailSyncError({
					message: "Failed to exchange authorization code for tokens",
					cause: error,
				}),
		});

		if (!tokens.access_token) {
			return yield* Effect.fail(
				new GmailSyncError({
					message: "No access token received from OAuth flow",
				}),
			);
		}

		yield* saveToken(account, {
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token ?? undefined,
			expiry_date: tokens.expiry_date ?? undefined,
		});

		yield* Effect.log(`OAuth flow completed for ${account.email}`);
	});
