import { randomUUID } from 'crypto';
import {
  AccountNotFoundError,
  BlertbankApiError,
  BlertbankError,
  UnauthorizedError,
} from './errors';
import { ApiErrorResponse, UserAccount, UserAccountRaw } from './types';

export type BlertbankClientConfig = {
  /**
   * Base URL of the Blertbank service.
   * Example: `http://localhost:3013`
   */
  baseUrl: string;

  /**
   * Service authentication token.
   */
  serviceToken: string;

  /**
   * Service name for logging and tracking.
   * Example: `'web-app'`, `'challenge-server'`
   */
  serviceName: string;

  /**
   * Optional fetch implementation. Defaults to global fetch.
   */
  fetch?: typeof fetch;

  /**
   * Optional function that returns the current request ID for distributed
   * tracing.
   * Useful for integrating with AsyncLocalStorage-based request contexts.
   *
   * @example
   * ```ts
   * const client = new BlertbankClient({
   *   // ...
   *   requestIdProvider: () => getRequestContext().requestId,
   * });
   * ```
   */
  requestIdProvider?: () => string | undefined;
};

/**
 * Options for individual API requests.
 */
export type RequestOptions = {
  /**
   * Request ID for distributed tracing. Overrides the provider if set.
   */
  requestId?: string;
};

/**
 * Client for interacting with the Blertbank service.
 */
export class BlertbankClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly serviceName: string;
  private readonly fetch: typeof fetch;
  private readonly requestIdProvider?: () => string | undefined;

  public constructor(config: BlertbankClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.serviceToken = config.serviceToken;
    this.serviceName = config.serviceName;
    this.fetch = config.fetch ?? globalThis.fetch;
    this.requestIdProvider = config.requestIdProvider;

    if (!this.serviceToken) {
      throw new BlertbankError('Service token is required');
    }
  }

  /**
   * Gets or creates a Blertcoin account for a user.
   *
   * @param userId ID of the user for whom to get or create an account
   * @param options Optional request options
   * @returns The account details
   */
  public async getOrCreateAccountForUser(
    userId: number,
    options?: RequestOptions,
  ): Promise<UserAccount> {
    // `/accounts` is an idempotent endpoint that will return the existing
    // account if it already exists.
    const response = await this.request<UserAccountRaw>(
      '/accounts',
      {
        method: 'POST',
        body: JSON.stringify({ userId }),
      },
      options,
    );

    return this.deserializeAccount(response);
  }

  /**
   * Gets account information for a user.
   *
   * @param userId ID of the user for whom to get account information
   * @param options Optional request options
   * @returns The account details
   * @throws {AccountNotFoundError} If the user doesn't have an account
   */
  public async getAccountByUserId(
    userId: number,
    options?: RequestOptions,
  ): Promise<UserAccount> {
    try {
      const response = await this.request<UserAccountRaw>(
        `/accounts/user/${userId}`,
        { method: 'GET' },
        options,
      );

      return this.deserializeAccount(response);
    } catch (error) {
      if (
        error instanceof BlertbankApiError &&
        error.errorCode === 'ACCOUNT_NOT_FOUND'
      ) {
        throw new AccountNotFoundError(userId);
      }
      throw error;
    }
  }

  /**
   * Gets the current balance for a user.
   *
   * @param userId ID of the user for whom to get balance
   * @param options Optional request options
   * @returns The user's current balance
   * @throws {AccountNotFoundError} If the user doesn't have an account
   */
  public async getBalance(
    userId: number,
    options?: RequestOptions,
  ): Promise<number> {
    const account = await this.getAccountByUserId(userId, options);
    return account.balance;
  }

  /**
   * Gets the balance for a user. If the user doesn't have an account, it will
   * be created with a balance of 0.
   *
   * @param userId ID of the user for whom to get balance
   * @param options Optional request options
   * @returns The user's current balance
   */
  public async getOrCreateBalance(
    userId: number,
    options?: RequestOptions,
  ): Promise<number> {
    return (await this.getOrCreateAccountForUser(userId, options)).balance;
  }

  /**
   * Checks if the Blertbank service is healthy.
   *
   * @returns True if the service is healthy
   */
  public async ping(): Promise<boolean> {
    try {
      const response = await this.fetch(`${this.baseUrl}/ping`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Makes an authenticated request to the Blertbank API.
   */
  private async request<T>(
    path: string,
    options: RequestInit = {},
    requestOptions?: RequestOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const requestId =
      requestOptions?.requestId ?? this.requestIdProvider?.() ?? randomUUID();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-Service-Token': this.serviceToken,
      'X-Service-Name': this.serviceName,
      'X-Request-ID': requestId,
      ...options.headers,
    };

    try {
      const response = await this.fetch(url, {
        ...options,
        headers,
      });

      // Handle error responses.
      if (!response.ok) {
        let errorResponse: ApiErrorResponse;
        try {
          errorResponse = (await response.json()) as ApiErrorResponse;
        } catch {
          throw new BlertbankApiError(
            response.status,
            'UNKNOWN_ERROR',
            `Request failed with status ${response.status}`,
          );
        }

        if (errorResponse.error === 'UNAUTHORIZED') {
          throw new UnauthorizedError(errorResponse.message);
        }

        throw BlertbankApiError.fromResponse(response.status, errorResponse);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BlertbankApiError) {
        throw error;
      }

      // Network errors or other fetch failures
      throw new BlertbankError(
        `Failed to connect to Blertbank: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Deserializes an account response, converting date strings to Date objects.
   */
  private deserializeAccount(account: UserAccountRaw): UserAccount {
    return {
      ...account,
      createdAt: new Date(account.createdAt),
      updatedAt: new Date(account.updatedAt),
    };
  }
}
