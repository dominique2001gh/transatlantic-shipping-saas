import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/marketing/AuthShell';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = { title: 'Create an Account' };

export default function RegisterPage() {
  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-bold text-slate-900">Create an account</h1>
      <p className="mt-2 text-sm text-slate-600">
        Sign up as a customer to start shipping, or contact us to onboard your company as a freight
        forwarding partner.
      </p>

      <form className="mt-8 flex flex-col gap-5">
        <TextInput label="First name" id="firstName" disabled className="bg-slate-50 text-slate-400" />
        <TextInput label="Last name" id="lastName" disabled className="bg-slate-50 text-slate-400" />
        <TextInput
          label="Email"
          id="email"
          type="email"
          disabled
          className="bg-slate-50 text-slate-400"
        />
        <Button type="button" size="lg" disabled className="mt-1 justify-center">
          Create Account
        </Button>
      </form>

      <p className="mt-6 text-xs text-slate-400">
        Self-service registration is not enabled yet. Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary-700">
          Log in
        </Link>
        .
      </p>
    </AuthShell>
  );
}
