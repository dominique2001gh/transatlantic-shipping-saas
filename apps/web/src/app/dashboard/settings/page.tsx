'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { TextArea, TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PasswordSection } from '@/components/account/PasswordSection';
import { ApiError } from '@/lib/api';
import { getTenantSiteConfig, updateTenantSiteConfig } from '@/lib/tenant-site-config';
import { serviceTypeOptions } from '@/lib/ananselogix/site-data';

/**
 * AnanseLogix Phase 2: the settings surface for Section 15's tenant-
 * branded website content — see apps/api/src/site-config's own doc
 * comment for the full scope (data management only, no public renderer
 * yet, never touches Trans Atlantic's own hardcoded site). Numbering
 * prefixes and staff access are configured elsewhere already (onboarding's
 * Tracking/Staff steps); this page is specifically the "public website
 * content" piece that didn't fit the initial onboarding wizard.
 */
export default function SettingsPage() {
  const [tagline, setTagline] = useState('');
  const [aboutContent, setAboutContent] = useState('');
  const [heroHeadline, setHeroHeadline] = useState('');
  const [heroSubheadline, setHeroSubheadline] = useState('');
  const [serviceTypes, setServiceTypes] = useState<string[]>([]);
  const [facebookUrl, setFacebookUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getTenantSiteConfig()
      .then((config) => {
        setTagline(config.tagline ?? '');
        setAboutContent(config.aboutContent ?? '');
        setHeroHeadline(config.heroHeadline ?? '');
        setHeroSubheadline(config.heroSubheadline ?? '');
        setServiceTypes(config.serviceTypes ?? []);
        setFacebookUrl(config.facebookUrl ?? '');
        setLinkedinUrl(config.linkedinUrl ?? '');
        setInstagramUrl(config.instagramUrl ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  function toggleService(service: string) {
    setServiceTypes((current) =>
      current.includes(service) ? current.filter((s) => s !== service) : [...current, service],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateTenantSiteConfig({
        tagline: tagline || undefined,
        aboutContent: aboutContent || undefined,
        heroHeadline: heroHeadline || undefined,
        heroSubheadline: heroSubheadline || undefined,
        serviceTypes,
        facebookUrl: facebookUrl || undefined,
        linkedinUrl: linkedinUrl || undefined,
        instagramUrl: instagramUrl || undefined,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your account and your company&apos;s public website content.
        </p>
      </div>

      <PasswordSection />

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Website content</h2>
        <p className="mt-1 text-sm text-slate-500">
          Public website content for your company (used by a future branded site).
        </p>

        {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}

        {!loading && (
          <Card className="mt-3 max-w-2xl">
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <TextInput
                label="Tagline"
                id="tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                maxLength={200}
              />
              <TextArea
                label="About"
                id="aboutContent"
                rows={4}
                value={aboutContent}
                onChange={(e) => setAboutContent(e.target.value)}
                maxLength={4000}
              />
              <TextInput
                label="Hero headline"
                id="heroHeadline"
                value={heroHeadline}
                onChange={(e) => setHeroHeadline(e.target.value)}
                maxLength={200}
              />
              <TextInput
                label="Hero subheadline"
                id="heroSubheadline"
                value={heroSubheadline}
                onChange={(e) => setHeroSubheadline(e.target.value)}
                maxLength={300}
              />

              <div>
                <span
                  id="settings-service-types-label"
                  className="block text-sm font-medium text-slate-700"
                >
                  Services offered
                </span>
                <div
                  role="group"
                  aria-labelledby="settings-service-types-label"
                  className="mt-2 flex flex-wrap gap-2"
                >
                  {serviceTypeOptions.map((service) => (
                    <button
                      key={service}
                      type="button"
                      aria-pressed={serviceTypes.includes(service)}
                      onClick={() => toggleService(service)}
                      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                        serviceTypes.includes(service)
                          ? 'border-primary-700 bg-primary-700 text-white'
                          : 'border-slate-300 text-slate-600 hover:border-primary-400'
                      }`}
                    >
                      {service}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <TextInput
                  label="Facebook URL"
                  id="facebookUrl"
                  value={facebookUrl}
                  onChange={(e) => setFacebookUrl(e.target.value)}
                  placeholder="https://facebook.com/..."
                />
                <TextInput
                  label="LinkedIn URL"
                  id="linkedinUrl"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/..."
                />
                <TextInput
                  label="Instagram URL"
                  id="instagramUrl"
                  value={instagramUrl}
                  onChange={(e) => setInstagramUrl(e.target.value)}
                  placeholder="https://instagram.com/..."
                />
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </Button>
                {saved && (
                  <p role="status" className="text-sm text-emerald-600">
                    Saved.
                  </p>
                )}
              </div>
            </form>
          </Card>
        )}
      </section>
    </div>
  );
}
