'use client';

import { useState, type FormEvent } from 'react';
import { PageHero } from '@/components/marketing/PageHero';
import { SelectInput, TextArea, TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { ApiError } from '@/lib/api';
import { submitPlatformLead } from '@/lib/ananselogix/leads';
import { serviceTypeOptions } from '@/lib/ananselogix/site-data';

export default function AnanseLogixDemoPage() {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [servicesOffered, setServicesOffered] = useState<string[]>([]);

  function toggleService(service: string) {
    setServicesOffered((current) => (current.includes(service) ? current.filter((s) => s !== service) : [...current, service]));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('submitting');
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await submitPlatformLead({
        companyName: String(form.get('companyName') ?? ''),
        contactName: String(form.get('contactName') ?? ''),
        phone: String(form.get('phone') ?? '') || undefined,
        email: String(form.get('email') ?? ''),
        country: String(form.get('country') ?? '') || undefined,
        currentWorkflow: String(form.get('currentWorkflow') ?? '') || undefined,
        monthlyShipmentVolume: String(form.get('monthlyShipmentVolume') ?? '') || undefined,
        currentSoftware: String(form.get('currentSoftware') ?? '') || undefined,
        servicesOffered,
        message: String(form.get('message') ?? '') || undefined,
      });
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <>
      <PageHero
        kicker="Request a Demo"
        title="Tell us about your shipping business"
        description="We'll show you AnanseLogix running on a workflow like yours."
      />
      <Container className="py-16 lg:py-20">
        <div className="mx-auto max-w-2xl">
          {status === 'success' ? (
            <div className="rounded-xl border border-accent-200 bg-accent-50 p-8 text-center">
              <h2 className="font-display text-xl font-semibold text-slate-900">Thanks — we got it.</h2>
              <p className="mt-2 text-sm text-slate-600">
                Our team will reach out shortly to schedule your demo.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <TextInput label="Company name" id="companyName" name="companyName" required />
                <TextInput label="Contact name" id="contactName" name="contactName" required />
                <TextInput label="Email" id="email" name="email" type="email" required />
                <TextInput label="Phone" id="phone" name="phone" type="tel" />
                <TextInput label="Country" id="country" name="country" />
                <TextInput label="Approx. monthly shipment volume" id="monthlyShipmentVolume" name="monthlyShipmentVolume" placeholder="e.g. 50-100 shipments" />
              </div>

              <SelectInput label="Current process" id="currentSoftware" name="currentSoftware" defaultValue="">
                <option value="" disabled>
                  Select one
                </option>
                <option value="Manual / spreadsheets">Manual / spreadsheets</option>
                <option value="Another software system">Another software system</option>
                <option value="No formal system yet">No formal system yet</option>
              </SelectInput>

              <div>
                <span id="services-offered-label" className="block text-sm font-medium text-slate-700">
                  Services offered
                </span>
                <div role="group" aria-labelledby="services-offered-label" className="mt-2 flex flex-wrap gap-2">
                  {serviceTypeOptions.map((service) => (
                    <button
                      key={service}
                      type="button"
                      aria-pressed={servicesOffered.includes(service)}
                      onClick={() => toggleService(service)}
                      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                        servicesOffered.includes(service)
                          ? 'border-primary-700 bg-primary-700 text-white'
                          : 'border-slate-300 text-slate-600 hover:border-primary-400'
                      }`}
                    >
                      {service}
                    </button>
                  ))}
                </div>
              </div>

              <TextArea label="Current shipping workflow" id="currentWorkflow" name="currentWorkflow" rows={3} />
              <TextArea label="Message" id="message" name="message" rows={3} />

              {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

              <Button type="submit" size="lg" disabled={status === 'submitting'} className="justify-center">
                {status === 'submitting' ? 'Sending…' : 'Request Demo'}
              </Button>
            </form>
          )}
        </div>
      </Container>
    </>
  );
}
