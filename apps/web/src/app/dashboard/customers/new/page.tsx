'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { createCustomer, type CreateCustomerInput } from '@/lib/customers';

const initialValues: CreateCustomerInput = { firstName: '', lastName: '', email: '', phone: '' };

export default function NewCustomerPage() {
  const router = useRouter();
  const [values, setValues] = useState<CreateCustomerInput>(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof CreateCustomerInput>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const customer = await createCustomer(values);
      router.push(`/dashboard/customers/${customer.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create customer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">New Customer</h1>
      <p className="mt-1 text-sm text-slate-500">Customer numbers are assigned automatically.</p>

      <Card className="mt-6">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <TextInput
            label="First name"
            id="firstName"
            required
            value={values.firstName}
            onChange={(event) => update('firstName', event.target.value)}
          />
          <TextInput
            label="Last name"
            id="lastName"
            required
            value={values.lastName}
            onChange={(event) => update('lastName', event.target.value)}
          />
          <TextInput
            label="Email"
            id="email"
            type="email"
            required
            value={values.email}
            onChange={(event) => update('email', event.target.value)}
          />
          <TextInput
            label="Phone"
            id="phone"
            type="tel"
            value={values.phone}
            onChange={(event) => update('phone', event.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting ? 'Creating…' : 'Create Customer'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
