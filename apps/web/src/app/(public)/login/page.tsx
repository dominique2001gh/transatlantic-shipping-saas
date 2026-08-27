'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { LoginResponseDto } from '@transatlantic/shared';
import { AuthShell } from '@/components/marketing/AuthShell';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
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
    <AuthShell>
      <h1 className="font-display text-2xl font-bold text-slate-900">Welcome back</h1>
      <p className="mt-2 text-sm text-slate-600">
        Staff, customers, and platform administrators all sign in here.
      </p>

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <TextInput
          label="Email"
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextInput
          label="Password"
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={loading} className="mt-1 justify-center">
          {loading ? 'Signing in…' : 'Sign In'}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-slate-500">
        New here?{' '}
        <Link href="/register" className="font-semibold text-primary-700 hover:text-primary-800">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
