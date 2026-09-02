'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { PortalCustomerProfile, PortalNotificationPreferences } from '@transatlantic/shared';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { changePassword } from '@/lib/account';
import { ApiError } from '@/lib/api';
import {
  getPortalNotificationPreferences,
  getPortalProfile,
  updatePortalNotificationPreferences,
  updatePortalProfile,
} from '@/lib/portal';

/**
 * Stage 3I: the customer's own Profile, Notification Preferences, and
 * Password — three independent forms, each with its own load/submit/
 * error/success state so a failure or a slow save in one never blocks or
 * clears the others. Every write here goes through /portal/me* or
 * /users/me/password, all scoped server-side to the caller's own account
 * — nothing on this page ever sends a customerId/tenantId/userId of its
 * own.
 */
export default function PortalProfilePage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Profile</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your contact details, notification preferences, and password.</p>
      </div>

      <ProfileSection />
      <NotificationPreferencesSection />
      <PasswordSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile: name + phone. Email and customer number are read-only.
// ---------------------------------------------------------------------------

function ProfileSection() {
  const [profile, setProfile] = useState<PortalCustomerProfile | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getPortalProfile()
      .then((data) => {
        setProfile(data);
        setFirstName(data.firstName);
        setLastName(data.lastName);
        setPhone(data.phone ?? '');
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Failed to load your profile.'));
  }, []);

  // Auto-revert the "Saved ✓" state a couple seconds after a successful
  // save, so it reads as momentary confirmation rather than a stale label.
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  /** Editing a field after a save clears the "Saved ✓" state immediately, so it can never look like it still reflects the current (unsaved) form values. */
  function handleFieldChange<T extends (value: string) => void>(setter: T, value: string) {
    setSaved(false);
    setter(value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      const updated = await updatePortalProfile({ firstName, lastName, phone: phone || undefined });
      setProfile(updated);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to save your profile.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">Profile</h2>
      <Card className="mt-3 max-w-lg">
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {!loadError && !profile && <p className="text-sm text-slate-500">Loading…</p>}
        {!loadError && profile && (
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <TextInput
              label="First name"
              id="firstName"
              required
              value={firstName}
              onChange={(event) => handleFieldChange(setFirstName, event.target.value)}
            />
            <TextInput
              label="Last name"
              id="lastName"
              required
              value={lastName}
              onChange={(event) => handleFieldChange(setLastName, event.target.value)}
            />
            <TextInput
              label="Phone"
              id="phone"
              type="tel"
              value={phone}
              onChange={(event) => handleFieldChange(setPhone, event.target.value)}
            />

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                disabled
                readOnly
                value={profile.email}
                className="mt-1.5 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500"
              />
              <p className="mt-1.5 text-xs text-slate-400">
                Your login email can&apos;t be changed here yet. Contact us if it needs to change.
              </p>
            </div>

            <div>
              <span className="block text-sm font-medium text-slate-700">Customer number</span>
              <p className="mt-1.5 text-sm text-slate-500">{profile.customerNumber}</p>
            </div>

            {saveError && (
              <p role="alert" className="text-sm font-medium text-red-600">
                {saveError}
              </p>
            )}
            <div className="mt-2 flex items-center gap-3">
              <Button
                type="submit"
                disabled={submitting}
                className={saved ? 'bg-green-700 hover:bg-green-700 focus-visible:outline-green-700' : ''}
              >
                {submitting ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
              </Button>
              <p role="status" aria-live="polite" className="text-sm font-medium text-green-700">
                {saved ? 'Your changes have been saved.' : ''}
              </p>
            </div>
          </form>
        )}
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Notification preferences: Email / SMS / WhatsApp toggles + WhatsApp
// number. In-app is always on and shown as informational only.
// ---------------------------------------------------------------------------

function NotificationPreferencesSection() {
  const [prefs, setPrefs] = useState<PortalNotificationPreferences | null>(null);
  const [notifyByEmail, setNotifyByEmail] = useState(true);
  const [notifyBySms, setNotifyBySms] = useState(false);
  const [notifyByWhatsapp, setNotifyByWhatsapp] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getPortalNotificationPreferences()
      .then((data) => {
        setPrefs(data);
        setNotifyByEmail(data.notifyByEmail);
        setNotifyBySms(data.notifyBySms);
        setNotifyByWhatsapp(data.notifyByWhatsapp);
        setWhatsappPhone(data.whatsappPhone ?? '');
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Failed to load your notification preferences.'));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      const updated = await updatePortalNotificationPreferences({
        notifyByEmail,
        notifyBySms,
        notifyByWhatsapp,
        whatsappPhone: notifyByWhatsapp ? whatsappPhone : (prefs?.whatsappPhone ?? null),
      });
      setPrefs(updated);
      setWhatsappPhone(updated.whatsappPhone ?? '');
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to save your notification preferences.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">Notification preferences</h2>
      <Card className="mt-3 max-w-lg">
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {!loadError && !prefs && <p className="text-sm text-slate-500">Loading…</p>}
        {!loadError && prefs && (
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-sm">
              <input type="checkbox" className="mt-0.5" checked disabled readOnly />
              <span>
                <span className="font-medium text-slate-900">In-app notifications</span>
                <span className="mt-0.5 block text-slate-500">
                  Always on. Updates about your shipments, invoices, and documents always appear in your Notifications
                  list, regardless of the settings below.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={notifyByEmail}
                onChange={(event) => setNotifyByEmail(event.target.checked)}
              />
              <span>
                <span className="font-medium text-slate-900">Email</span>
                <span className="mt-0.5 block text-slate-500">Also email me the same updates.</span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={notifyBySms}
                onChange={(event) => setNotifyBySms(event.target.checked)}
              />
              <span>
                <span className="font-medium text-slate-900">SMS</span>
                <span className="mt-0.5 block text-slate-500">Also text me the same updates.</span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={notifyByWhatsapp}
                onChange={(event) => setNotifyByWhatsapp(event.target.checked)}
              />
              <span>
                <span className="font-medium text-slate-900">WhatsApp</span>
                <span className="mt-0.5 block text-slate-500">Also message me on WhatsApp.</span>
              </span>
            </label>

            {notifyByWhatsapp && (
              <TextInput
                label="WhatsApp number"
                id="whatsappPhone"
                type="tel"
                required
                placeholder="+233201234567"
                value={whatsappPhone}
                onChange={(event) => setWhatsappPhone(event.target.value)}
              />
            )}

            {saveError && (
              <p role="alert" className="text-sm text-red-600">
                {saveError}
              </p>
            )}
            {saved && <p className="text-sm text-green-700">Saved.</p>}
            <Button type="submit" disabled={submitting} className="mt-2 self-start">
              {submitting ? 'Saving…' : 'Save preferences'}
            </Button>
          </form>
        )}
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Password change.
// ---------------------------------------------------------------------------

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change your password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">Password</h2>
      <Card className="mt-3 max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <TextInput
            label="Current password"
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <TextInput
            label="New password"
            id="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <TextInput
            label="Confirm new password"
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <p className="text-xs text-slate-400">At least 8 characters.</p>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {saved && <p className="text-sm text-green-700">Password changed.</p>}
          <Button type="submit" disabled={submitting} className="mt-2 self-start">
            {submitting ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      </Card>
    </section>
  );
}
