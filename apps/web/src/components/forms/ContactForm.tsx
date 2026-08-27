'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { TextArea, TextInput } from '@/components/forms/FormField';
import { submitContactRequest, type ContactRequestInput } from '@/lib/contact';

const initialValues: ContactRequestInput = { name: '', email: '', phone: '', subject: '', message: '' };

export function ContactForm() {
  const [values, setValues] = useState<ContactRequestInput>(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof ContactRequestInput>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await submitContactRequest(values);
      setSubmitted(true);
    } catch {
      setError('Something went wrong sending your message. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8">
        <p className="font-display text-lg font-semibold text-emerald-800">Message received</p>
        <p className="mt-2 text-sm text-emerald-700">
          Thanks for reaching out — our team will get back to you shortly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-5 sm:grid-cols-2" noValidate>
      <TextInput
        label="Full name"
        id="name"
        required
        value={values.name}
        onChange={(event) => update('name', event.target.value)}
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
      <TextInput
        label="Subject"
        id="subject"
        required
        value={values.subject}
        onChange={(event) => update('subject', event.target.value)}
      />
      <div className="sm:col-span-2">
        <TextArea
          label="Message"
          id="message"
          rows={5}
          required
          value={values.message}
          onChange={(event) => update('message', event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send Message'}
        </Button>
      </div>
    </form>
  );
}
