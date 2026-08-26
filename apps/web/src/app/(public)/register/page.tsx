import type { Metadata } from 'next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = { title: 'Create an Account' };

export default function RegisterPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-slate-900">Create an account</h1>
      <p className="mt-2 text-sm text-slate-600">
        Sign up as a customer to start shipping, or contact us to onboard your company as a
        freight forwarding partner.
      </p>

      <Card className="mt-8">
        <form className="flex flex-col gap-4">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-slate-700">
              First name
            </label>
            <input
              id="firstName"
              type="text"
              disabled
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400"
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-slate-700">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              disabled
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              disabled
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400"
            />
          </div>
          <Button type="button" disabled className="mt-2">
            Create Account
          </Button>
        </form>
        <p className="mt-4 text-xs text-slate-400">
          Self-service registration is not enabled yet. Already have an account?{' '}
          <a href="/login" className="font-medium text-primary-700">
            Log in
          </a>
          .
        </p>
      </Card>
    </div>
  );
}
