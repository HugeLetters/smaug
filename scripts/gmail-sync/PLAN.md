# Gmail Sync Script Implementation Plan

## Overview
Script to sync bank transaction emails from multiple Gmail accounts to a Google Sheets spreadsheet, tracking processed emails with labels.

## Dependencies

Add to package.json:
```json
{
  "dependencies": {
    "googleapis": "^133.0.0"
  }
}
```

Run: `bun add googleapis`

## File Structure

```
scripts/gmail-sync/
├── index.ts          # Entry point with cron scheduling
├── config.ts         # Configuration loading (accounts, spreadsheet)
├── types.ts          # Domain types and schemas
├── gmail.ts          # Gmail API client + label management
├── parser.ts         # Bank parser registry (pluggable)
├── sheets.ts         # Google Sheets API client
└── PLAN.md           # This file
```

## Step-by-Step Implementation

### Step 1: Create types.ts
Define core domain types:

1. **Transaction Schema** (effect/schema)
   - id: string (generated)
   - date: Date
   - amount: number
   - currency: string (default "CLP")
   - merchant: string
   - account: string (which Gmail account)
   - bankName: string (which parser matched)
   - rawEmailId: string
   - rawSnippet: string (preview)

2. **GmailAccount type**
   - email: string
   - credentialsPath: string (OAuth client secrets)
   - tokenPath: string (stored refresh token)

3. **Config type**
   - accounts: GmailAccount[]
   - spreadsheetId: string
   - labelName: string (constant: "synced-to-shared-expenses-sheet")
   - cronSchedule: string (default: "0 9 * * *" for 9 AM daily)

4. **Error types** (Data.TaggedError)
   - GmailSyncError
   - ConfigError
   - ParserError
   - SheetsError

### Step 2: Create config.ts
Configuration loading module:

1. **Load config from file**
   - Read Bun.secrets API - create an effect wrapper to read Bun secrets to Effect/Config.
   - Use Schema.decodeUnknown for validation
   - Return Config type

Also create a script to save config with Bun.secrets - use Effect/Scheme to decode/encode the config

2. **Config file format** (as json just as an example - actually use Effect Schema):
   ```json
   {
     "spreadsheetId": "YOUR_SPREADSHEET_ID",
     "accounts": [
       {
         "email": "user1@gmail.com",
         "credentialsPath": "./credentials/user1.json",
         "tokenPath": "./tokens/user1.json"
       }
     ]
   }
   ```

3. **Effects**:
   - loadConfig(): Effect<Config, ConfigError>
   - validateCredentials(account): Effect<void, ConfigError>

### Step 3: Create gmail.ts
Gmail API integration:

1. **OAuth2 setup**
   - Create OAuth2 client from credentials file
   - Load stored token or trigger auth flow
   - Auto-refresh access token

2. **Core functions**:
   - `createGmailClient(account): Effect<gmail_v1.Gmail, GmailSyncError>`
   - `getOrCreateLabel(client, labelName): Effect<string, GmailSyncError>` 
     - Returns label ID (creates if not exists)
   - `fetchUnprocessedEmails(client, labelId): Effect<Email[], GmailSyncError>`
     - Query: `-label:synced-to-shared-expenses-sheet category:primary`
     - Return array of email objects (id, snippet, payload)
   - `applyLabel(client, emailId, labelId): Effect<void, GmailSyncError>`
   - `getEmailContent(client, emailId): Effect<string, GmailSyncError>`
     - Extract plain text body from multipart

3. **Error handling**:
   - Wrap Google API errors in tagged errors
   - Handle rate limiting with retry

### Step 4: Create parser.ts
Pluggable bank parser system:

1. **Parser interface**:
   ```typescript
   interface BankParser {
     readonly name: string;
     readonly parse: (email: Email) => Effect<Option<Transaction>, ParserError>;
   }
   ```

2. **Parser registry**:
   - Map<string, BankParser>
   - registerParser(parser): void
   - findParser(email): Option<BankParser>

3. **Placeholder parsers** (implement real ones later):
   - ChaseParser (structure only)
   - BankOfAmericaParser (structure only)
   - GenericParser fallback

4. **Email parsing utilities**:
   - extractTextFromHtml(html): string
   - extractAmount(text): Option<number>
   - extractDate(text): Option<Date>
   - extractMerchant(text): Option<string>

5. **Main parse function**:
   - parseEmail(email): Effect<Option<Transaction>, ParserError>
   - Try all registered parsers in order
   - Return first successful parse

### Step 5: Create sheets.ts
Google Sheets API (placeholder for now):

1. **Sheets client setup**:
   - `createSheetsClient(credentials): Effect<sheets_v4.Sheets, SheetsError>`
   - Reuse Gmail OAuth2 (same scopes needed)

2. **Placeholder functions**:
   - `appendTransactions(transactions): Effect<void, SheetsError>`
     - Log transactions to console (TODO: implement real append)
   - `ensureHeaders(): Effect<void, SheetsError>`
     - Check/create header row

3. **Target format** (columns):
   - Date | Account | Amount | Currency | Merchant | Bank | Raw Snippet

4. **TODO comments**:
   - Mark where to add real Sheets API calls
   - Include example code for appendRows

### Step 6: Create index.ts
Main entry point with cron:

1. **Setup**:
   ```typescript
   import { BunContext, BunRuntime } from "@effect/platform-bun";
   import * as Effect from "effect/Effect";
   import * as Schedule from "effect/Schedule";
   import * as Cron from "effect/Cron";
   import * as Logger from "effect/Logger";
   ```

2. **Main effect**:
   ```typescript
   const syncEffect = Effect.gen(function* () {
     yield* Effect.log("Starting Gmail sync...");
     
     // Load config
     const config = yield* loadConfig();
     yield* Effect.log(`Processing ${config.accounts.length} accounts`);
     
     // Process each account
     const results = yield* Effect.all(
       config.accounts.map(account => 
         processAccount(account, config.spreadsheetId)
           .pipe(Effect.catchAll(error => 
             Effect.logError(`Failed to process ${account.email}: ${error}`).pipe(
               Effect.map(() => [] as Transaction[])
             )
           ))
       ),
       { concurrency: 1 } // Sequential to avoid rate limits
     );
     
     // Flatten and write transactions
     const allTransactions = results.flat();
     yield* Effect.log(`Found ${allTransactions.length} transactions`);
     
     if (allTransactions.length > 0) {
       yield* appendTransactions(allTransactions);
       yield* Effect.log("Transactions written to sheet");
     }
     
     yield* Effect.log("Sync complete");
   });
   ```

3. **Account processing**:
   ```typescript
   const processAccount = (account: GmailAccount, spreadsheetId: string) => 
     Effect.gen(function* () {
       yield* Effect.log(`Processing account: ${account.email}`);
       
       const client = yield* createGmailClient(account);
       const labelId = yield* getOrCreateLabel(client, LABEL_NAME);
       const emails = yield* fetchUnprocessedEmails(client, labelId);
       
       yield* Effect.log(`Found ${emails.length} unprocessed emails`);
       
       const transactions: Transaction[] = [];
       
       for (const email of emails) {
         const parsed = yield* parseEmail(email);
         
         if (Option.isSome(parsed)) {
           transactions.push(parsed.value);
           yield* applyLabel(client, email.id, labelId);
           yield* Effect.log(`Processed transaction: ${parsed.value.merchant} - ${parsed.value.amount}`);
         }
       }
       
       return transactions;
     });
   ```

4. **Cron scheduling**:
   ```typescript
   const cronSchedule = Schedule.cron("0 9 * * *"); // Daily at 9 AM
   
   const scheduledSync = Effect.repeat(
     syncEffect,
     Schedule.intersect(cronSchedule, Schedule.recurs(Infinity))
   );
   ```

5. **Entry point**:
   ```typescript
   scheduledSync.pipe(
     Effect.provide([Logger.pretty, BunContext.layer]),
     BunRuntime.runMain
   );
   ```

6. **CLI mode** (optional):
   - Add --run-once flag to run immediately without cron
   - Parse args using @effect/cli if available, or simple process.argv

## Testing Steps

1. **Setup Gmail API**:
   - Go to Google Cloud Console
   - Enable Gmail API and Sheets API
   - Create OAuth2 credentials (Desktop app)
   - Download client_secret.json

2. **First run auth**:
   - Run script manually: `bun run scripts/gmail-sync/index.ts`
   - OAuth flow will open browser
   - Authorize and copy code back to CLI
   - Token saved for future runs

3. **Test email**:
   - Send test transaction email to yourself
   - Run script with --run-once
   - Verify transaction logged
   - Verify label applied

4. **Add real parsers**:
   - Get example emails from your banks
   - Implement specific parsers
   - Test with real data

## Implementation Order

1. ✅ Create PLAN.md (this file)
2. ⬜ Install googleapis dependency
3. ⬜ Create types.ts with schemas
4. ⬜ Create config.ts with loading
5. ⬜ Create gmail.ts with auth and fetch
6. ⬜ Create parser.ts with registry
7. ⬜ Create sheets.ts (placeholder)
8. ⬜ Create index.ts with cron
9. ⬜ Test basic flow
10. ⬜ Add real parsers
11. ⬜ Implement actual Sheets writing

## Notes

- Use Effect's error handling throughout (no throwing)
- Follow existing patterns in codebase (see src/utils/differ, scripts/build.ts)
- Keep parsers modular for easy bank additions
- Log everything for debugging
- Handle OAuth token expiration gracefully
