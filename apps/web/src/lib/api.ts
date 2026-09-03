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

/**
 * Minimal JSON fetch wrapper. Attaches the stored access token, if any.
 *
 * Stage 3G: when `body` is a `FormData` (a document upload), the
 * `Content-Type` header is left for the browser to set itself — it must
 * include the multipart boundary, which nothing here can predict; forcing
 * `application/json` would silently break every upload.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && rest.body instanceof FormData;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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
      logout('expired');
    }

    throw new ApiError(message, response.status);
  }

  return body as T;
}

/**
 * Stage 3G: downloads a file from an authenticated endpoint
 * (/documents/:id/download, /portal/documents/:id/download) and saves it
 * via the browser — a plain `<a href>` can't carry an Authorization
 * header, and these endpoints require one (that's the actual
 * ownership/tenant-isolation check; there is no other way to reach the
 * file). Reads the real filename off Content-Disposition when the server
 * sent one, falling back to the caller's own guess.
 */
export async function downloadAuthenticatedFile(path: string, token: string, fallbackFileName: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const body = isJson ? await response.json() : undefined;
    const message = Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? 'Download failed.');
    if (response.status === 401) {
      logout();
    }
    throw new ApiError(message, response.status);
  }

  const disposition = response.headers.get('content-disposition');
  const fileName = parseFileNameFromDisposition(disposition) ?? fallbackFileName;

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function parseFileNameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const plainMatch = /filename="?([^";]+)"?/i.exec(disposition);
  return plainMatch ? plainMatch[1] : null;
}
