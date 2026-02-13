/**
 * Timeout utility for wallet operations.
 * Prevents indefinite hangs when wallet doesn't respond.
 */

export class WalletTimeoutError extends Error {
  constructor(message = "Wallet operation timed out") {
    super(message);
    this.name = "WalletTimeoutError";
  }
}

/**
 * Wraps a promise with a timeout.
 * Rejects with WalletTimeoutError if the promise doesn't resolve within the timeout.
 *
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds (default: 30000)
 * @returns The resolved value of the promise
 * @throws WalletTimeoutError if timeout is reached
 */
export function withTimeout<T>(promise: Promise<T>, ms = 30000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new WalletTimeoutError(`Operation timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}
