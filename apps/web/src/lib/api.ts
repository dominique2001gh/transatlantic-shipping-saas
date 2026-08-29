import { logout } from './auth';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Minimal JSON fetch wrapper. Attaches the stored access token, if any. */
export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : undefined;

  if (!response.ok) {
    const message = Array.isArray(body?.message)
      ? body.message.join(', ')
      : (body?.message ?? 'Something went wrong. Please try again.');

    // A 401 only means "the session itself is bad" when the request that
    // got rejected actually carried a bearer token — JwtAuthGuard is what
    // returns 401 (expired/invalid/malformed token, or the account/tenant
    // behind it no longer validates; see JwtStrategy.validate). A public,
    // token-less call rejected with 401 (e.g. a wrong-password attempt on
    // /auth/login, which the backend also reports as 401) is not a stale
    // session and must not trigger a logout/redirect. 403 (RolesGuard —
    // authenticated but not permitted) is intentionally never handled
    // here: it stays a normal, visible authorization error.
    if (response.status === 401 && token) {
      logout();
    }

    throw new ApiError(message, response.status);
  }

  return body as T;
}
