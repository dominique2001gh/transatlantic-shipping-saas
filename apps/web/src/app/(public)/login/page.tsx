'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { LoginResponseDto } from '@transatlantic/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { apiFetch, ApiError } from '@/lib/api';
import { homeRouteForRole, storeSession } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await apiFetch<LoginResponseDto>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      storeSession(response.accessToken, response.user);
      router.push(homeRouteForRole(response.user.role));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to log in right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-slate-900">Log in</h1>
      <p className="mt-2 text-sm text-slate-600">
        Staff, customers, and platform administrators all sign in here.
      </p>

      <Card className="mt-8">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" disabled={loading} className="mt-2">
            {loading ? 'Logging in…' : 'Log In'}
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-center text-sm text-slate-500">
        New here?{' '}
        <Link href="/register" className="font-medium text-primary-700 hover:text-primary-800">
          Create an account
        </Link>
      </p>
    </div>
  );
}
