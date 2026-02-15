# Gmail Sync Script Implementation Plan

## Overview
Script to sync bank transaction emails from multiple Gmail accounts to a Google Sheets spreadsheet, tracking processed emails with labels.

## Dependencies

Already installed:
- `googleapis`: ^171.4.0
- `@effect/cli`: ^0.73.2

## File Structure

```
scripts/gmail-sync/
├── index.ts          # Entry point with CLI and cron scheduling
├── config.ts         # Configuration loading
├── types.ts          # Domain types and schemas
├── gmail.ts          # Gmail API client
├── parser.ts         # Bank parser registry
├── sheets.ts         # Google Sheets API
└── PLAN.md           # This file
```

## Key Implementation Details

### types.ts
- Transaction schema with id, date, amount, currency, merchant, account, bankName
- GmailAccount type (email, credentialsPath, tokenPath)
- Config type (accounts, spreadsheetId)
- Tagged errors: GmailSyncError, ConfigError, ParserError, SheetsError

### config.ts
- Load from Bun.secrets with Effect/Config wrapper
- Schema validation using Effect/Schema
- Effects: loadConfig(), validateCredentials()

### gmail.ts
- OAuth2 client setup with auto-refresh
- Query: `-label:synced-to-shared-expenses-sheet category:primary`
- Effects: createGmailClient, getOrCreateLabel, fetchUnprocessedEmails, applyLabel

### parser.ts
- Pluggable BankParser interface
- Registry pattern for multiple bank parsers
- Utilities: extractTextFromHtml, extractAmount, extractDate, extractMerchant

### sheets.ts
- Placeholder for Google Sheets integration
- Target columns: Date | Account | Amount | Currency | Merchant | Bank | Raw Snippet

### index.ts
- Uses @effect/cli for --run-once flag
- Cron schedule: "0 9 * * *" (daily at 9 AM)
- Sequential processing (concurrency: 1)

## Testing Steps

1. **Setup Gmail API**:
   - Enable Gmail API and Sheets API in Google Cloud Console
   - Create OAuth2 credentials (Desktop app)
   - Download client_secret.json

2. **First run**:
   - Run: `bun run scripts/gmail-sync/index.ts --run-once`
   - Complete OAuth flow
   - Token saved for future runs

3. **Test email**:
   - Send test transaction email
   - Run with --run-once
   - Verify transaction logged and label applied

4. **Add parsers**:
   - Implement bank-specific parsers
   - Test with real data

## Implementation Order

1. ✅ Create PLAN.md
2. ✅ Dependencies (already installed)
3. ⬜ types.ts
4. ⬜ config.ts
5. ⬜ gmail.ts
6. ⬜ parser.ts
7. ⬜ sheets.ts (placeholder)
8. ⬜ index.ts
9. ⬜ Test basic flow
10. ⬜ Add real parsers
11. ⬜ Implement Sheets writing

## Guidelines

- Use Effect's error handling (no throwing)
- Follow existing patterns (src/utils/differ, scripts/build.ts)
- Keep parsers modular
- Log everything for debugging
- Handle OAuth expiration gracefully
