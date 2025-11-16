# Blertbank client

TypeScript client library for interacting with the Blertbank service.

## Usage

### Initialize the client

```typescript
import { BlertbankClient } from '@blert/blertbank-client';

const blertbank = new BlertbankClient({
  baseUrl: process.env.BLERTBANK_URL || 'http://localhost:3013',
  serviceToken: process.env.BLERTBANK_SERVICE_TOKEN!,
  serviceName: 'web-app',
});
```

## API reference

### `BlertbankClient`

#### Constructor

```typescript
new BlertbankClient(config: BlertbankClientConfig)
```

- `config.baseUrl`: Base URL of the Blertbank service
- `config.serviceToken`: Service authentication token
- `config.serviceName`: Service name for logging and tracking

#### Methods

**`getOrCreateAccountForUser(userId: number): Promise<UserAccount>`**

Gets account information for a user, creating a new a Blertcoin account if one
doesn't already exist.

**`getAccountByUserId(userId: number): Promise<UserAccount>`**

Gets account information for a user. Throws `AccountNotFoundError` if account
doesn't exist.

**`getBalance(userId: number): Promise<number>`**

Gets the current balance for a user. Throws `AccountNotFoundError` if account
doesn't exist.

**`getOrCreateBalance(userId: number): Promise<number>`**

Gets the balance for a user, creating an account if it doesn't exist.

**`ping(): Promise<boolean>`**

Checks if the Blertbank service is healthy.

## Error Handling

The client provides specific error classes for different failure scenarios:

```typescript
import {
  BlertbankError,
  BlertbankApiError,
  AccountNotFoundError,
  UnauthorizedError,
} from '@blert/blertbank-client';

try {
  const balance = await blertbank.getBalance(userId);
} catch (error) {
  if (error instanceof AccountNotFoundError) {
    // Handle account not found
  } else if (error instanceof UnauthorizedError) {
    // Handle authentication failure
  } else if (error instanceof BlertbankApiError) {
    // Handle other API errors
    console.error(`API error ${error.errorCode}: ${error.message}`);
  } else if (error instanceof BlertbankError) {
    // Handle client errors (network issues, etc.)
  }
}
```

## Development

```bash
# Build the library
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests with verbose output
npm run test:verbose
```
