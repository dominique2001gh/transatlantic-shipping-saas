'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { CustomerSummary, ShipmentSummary, StaffPreRegistrationLookup, WarehouseSummary } from '@transatlantic/shared';
import { OPERATIONS_ROLES, ShipmentItemType, ShipmentMode, WeightUnit } from '@transatlantic/shared';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { SelectInput, TextArea, TextInput } from '@/components/forms/FormField';
import { SearchableSelect } from '@/components/forms/SearchableSelect';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SendDropoffLinkCard } from '@/components/warehouse/SendDropoffLinkCard';
import { ApiError } from '@/lib/api';
import { createCustomer, listCustomers, type DuplicateCustomerErrorBody } from '@/lib/customers';
import { humanizeEnumValue } from '@/lib/format';
import { scanPreRegistrationForStaff } from '@/lib/pre-registrations';
import { createQuickReceive } from '@/lib/shipments';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { listWarehouseLocations } from '@/lib/warehouse';

/** Messages for a found-but-ineligible pre-registration — the exact-match /pre-registrations/scan lookup returns any status, never just SUBMITTED, so this page decides what's loadable. DRAFT is included for completeness even though a draft has no referenceNumber yet and so can never actually match a scan. */
const PRE_REGISTRATION_STATUS_MESSAGES: Record<string, string> = {
  DRAFT: 'This drop-off is still a draft — the customer has not submitted it yet.',
  CANCELLED: 'This drop-off was cancelled by the customer.',
  CONVERTED: 'This drop-off has already been received and converted into a shipment.',
  EXPIRED: 'This drop-off expired before it reached the warehouse.',
};

/** SearchableSelect's option shape only ever needs these fields — both CustomerSummary (from listCustomers/createCustomer) and PreRegistrationStaffCustomer (from a loaded pre-registration) satisfy it structurally. */
type QuickReceiveCustomerOption = Pick<CustomerSummary, 'id' | 'customerNumber' | 'firstName' | 'lastName' | 'email' | 'phone'>;

const CUSTOMER_SEARCH_DEBOUNCE_MS = 250;
/** Staff must type at least this many characters before a server search fires — an empty/near-empty query would otherwise ask the API to return every tenant customer, exactly what Phase 2 removed. */
const CUSTOMER_SEARCH_MIN_CHARS = 2;

function emptyRecipient() {
  return {
    recipientName: '',
    recipientPhone: '',
    recipientEmail: '',
    recipientAddressLine1: '',
    recipientAddressLine2: '',
    recipientCity: '',
    recipientState: '',
    recipientCountry: '',
    recipientPostalCode: '',
  };
}

/**
 * Quick Receive (Phase 2): one screen that replaces "create a shipment,
 * then walk N packages to a scanner" with one confirmation, now
 * production-hardened for real warehouse staff receiving many customers
 * back-to-back. Reuses the exact same customer create, warehouse list, and
 * label-printing pages as the rest of the app — see
 * ShipmentsService.createQuickReceive for what happens server-side (one
 * transaction: shipment + N items, all already RECEIVED_ORIGIN_WAREHOUSE,
 * no scan required).
 *
 * Deliberately does NOT replace New Shipment (`/dashboard/shipments/new`)
 * or Warehouse -> Receive — both are unchanged and still the right tool
 * when items need individual descriptions/weights up front, or when
 * packages already exist and are only now physically arriving to be
 * scanned one at a time.
 *
 * Phase 2 changes from Phase 1:
 *   - Origin geography is no longer a free-text field defaulting to a
 *     hardcoded country — it's read straight off the selected warehouse's
 *     own city/state/country (see WarehouseSummary), the same warehouse
 *     record every other part of this app already treats as authoritative
 *     for its own location. Nothing here assumes any tenant's country.
 *   - Optional destination-warehouse selector, reusing the existing
 *     Shipment.destinationWarehouseId FK — purely additive, never
 *     overrides the staff-entered destination country/location (a real
 *     destination may be a port/airport the tenant hasn't modeled as a
 *     Warehouse row).
 *   - Required recipient/consignee fields (name + international-friendly
 *     phone; email/address optional) — captured once per shipment, not
 *     per package, and read downstream by Pickup/Delivery as a prefillable
 *     default (see PickupWorkspace.resetForm).
 *   - Customer search is server-side and debounced instead of loading
 *     every tenant customer into the browser on mount.
 *   - Inline customer creation surfaces CustomersService's duplicate-email/
 *     phone check (409) with a way to use the existing match or confirm a
 *     deliberate second customer, instead of silently creating either way.
 *   - A successful submit no longer hard-navigates to the labels page —
 *     it shows an in-page confirmation with Print Labels (opens the
 *     labels page in a new tab, so this screen stays ready) and Receive
 *     Another (resets the form, keeps the same origin warehouse, and
 *     re-focuses the customer search field), so staff can move to the
 *     next customer without leaving Quick Receive.
 */
export default function QuickReceivePage() {
  // Page-level narrowing of DashboardLayout's own (deliberately broad,
  // all-staff-roles) useRequireAuth gate — same hook, same pattern, just
  // scoped to this one page's actual allowed roles (OPERATIONS_ROLES),
  // matching nav.ts's Quick Receive entry and every server-side @Roles()
  // guard this page's own requests hit (ShipmentsController,
  // WarehouseController). Direct-URL navigation by a role outside
  // OPERATIONS_ROLES (e.g. FINANCE) is redirected before the form ever
  // renders — the layout's own broad gate lets every dashboard role
  // *reach* /dashboard/*, so a page whose allowed roles are narrower than
  // that must do its own check, the same way this hook's `allowedRoles`
  // parameter is already designed to support.
  //
  // Per useRequireAuth's own doc comment, this is UX only, not the
  // security boundary — every request this page makes (GET /warehouse/
  // locations, GET /customers, POST /shipments/quick-receive) is already
  // independently gated server-side by the identical OPERATIONS_ROLES
  // list, so a role this hook doesn't catch (e.g. a forged/stale client
  // state) still can't read or mutate anything through the API.
  const { user, loading: authLoading } = useRequireAuth(OPERATIONS_ROLES);

  const [customers, setCustomers] = useState<QuickReceiveCustomerOption[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [customerSearching, setCustomerSearching] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseSummary[] | null>(null);
  const [originWarehouseId, setOriginWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');

  const [shipmentMode, setShipmentMode] = useState<ShipmentMode>(ShipmentMode.OCEAN_LCL);
  const [destinationCountry, setDestinationCountry] = useState('');
  const [destinationLocation, setDestinationLocation] = useState('');
  const [description, setDescription] = useState('');

  const [recipient, setRecipient] = useState(emptyRecipient());
  const [showRecipientAddress, setShowRecipientAddress] = useState(false);

  const [packageCount, setPackageCount] = useState(1);
  const [itemType, setItemType] = useState<ShipmentItemType>(ShipmentItemType.BOX);
  const [itemDescription, setItemDescription] = useState('');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(WeightUnit.LB);
  const [notes, setNotes] = useState('');

  // Customer Self-Service Pre-Registration, Stage 3: "Prepared Drop-Off?"
  // lookup. `loadedPreReg` is the only thing that makes this a conversion —
  // its `id` is sent as `preRegistrationId` on submit; everything else
  // below is identical to normal walk-in Quick Receive.
  const [preRegCode, setPreRegCode] = useState('');
  const [preRegLoading, setPreRegLoading] = useState(false);
  const [preRegError, setPreRegError] = useState<string | null>(null);
  const [loadedPreReg, setLoadedPreReg] = useState<StaffPreRegistrationLookup | null>(null);

  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [duplicateMatches, setDuplicateMatches] = useState<CustomerSummary[] | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ShipmentSummary | null>(null);
  /** Bumped on every "Receive Another" so the customer SearchableSelect fully remounts — the cleanest way to force its native autoFocus to re-fire without giving this component an imperative ref API it doesn't otherwise need. */
  const [formInstanceKey, setFormInstanceKey] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return; // unauthorized-role redirect is already in flight; no point fetching data that would 403 anyway
    listWarehouseLocations()
      .then((list) => {
        setWarehouses(list);
        const preferred = list.find((warehouse) => warehouse.isOriginWarehouse) ?? list[0];
        if (preferred) setOriginWarehouseId(preferred.id);
      })
      .catch(() => setWarehouses([]));
  }, [user]);

  // Explicit imperative focus, not just the declarative `autoFocus` prop on
  // SearchableSelect below: on "Receive Another", the field being focused
  // is the same button that was just clicked, and some browsers apply
  // their own "keep focus on the just-clicked button" default after
  // React's commit — which can silently beat a plain `autoFocus`. Running
  // this in an effect (fires after paint) reliably wins that race. Also
  // covers the page's very first load, since `formInstanceKey` starts at 0.
  useEffect(() => {
    document.getElementById('customerId')?.focus();
  }, [formInstanceKey]);

  function searchCustomers(query: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < CUSTOMER_SEARCH_MIN_CHARS) {
      setCustomers([]);
      setCustomerSearching(false);
      return;
    }
    setCustomerSearching(true);
    debounceRef.current = setTimeout(() => {
      listCustomers(trimmed)
        .then((results) => {
          setCustomers(results);
          setCustomerSearching(false);
        })
        .catch(() => {
          setCustomers([]);
          setCustomerSearching(false);
        });
    }, CUSTOMER_SEARCH_DEBOUNCE_MS);
  }

  /**
   * Prefills from a loaded SUBMITTED pre-registration — never overwrites a
   * field the customer left blank, and never blindly creates anything by
   * itself: this only populates the same form fields below, which staff
   * still review/correct and submit through the normal handleSubmit path.
   */
  function applyPreRegistration(record: StaffPreRegistrationLookup) {
    setCustomers((prev) => (prev.some((c) => c.id === record.customer.id) ? prev : [record.customer, ...prev]));
    setCustomerId(record.customer.id);
    if (record.shipmentMode) setShipmentMode(record.shipmentMode);
    if (record.destinationCountry) setDestinationCountry(record.destinationCountry);
    if (record.destinationLocation) setDestinationLocation(record.destinationLocation);
    setRecipient((prev) => ({
      recipientName: record.recipientName ?? prev.recipientName,
      recipientPhone: record.recipientPhone ?? prev.recipientPhone,
      recipientEmail: record.recipientEmail ?? prev.recipientEmail,
      recipientAddressLine1: record.recipientAddressLine1 ?? prev.recipientAddressLine1,
      recipientAddressLine2: record.recipientAddressLine2 ?? prev.recipientAddressLine2,
      recipientCity: record.recipientCity ?? prev.recipientCity,
      recipientState: record.recipientState ?? prev.recipientState,
      recipientCountry: record.recipientCountry ?? prev.recipientCountry,
      recipientPostalCode: record.recipientPostalCode ?? prev.recipientPostalCode,
    }));
    if (record.recipientAddressLine1 || record.recipientCity || record.recipientState) {
      setShowRecipientAddress(true);
    }
    if (record.packageCount) setPackageCount(Math.max(1, Math.min(50, record.packageCount)));
    if (record.itemType) setItemType(record.itemType);
    // Pre-registration's "description" is the customer's own package
    // description (e.g. "Household goods, mixed boxes") — the same concept
    // as this form's per-package `itemDescription`, not the shipment-level
    // `description` field below.
    if (record.description) setItemDescription(record.description);
    if (record.notes) setNotes(record.notes);
    setFieldErrors({});
    setLoadedPreReg(record);
    setPreRegCode('');
    setPreRegError(null);
  }

  async function loadPreRegistration() {
    const code = preRegCode.trim();
    if (!code) return;
    setPreRegError(null);
    setPreRegLoading(true);
    try {
      const record = await scanPreRegistrationForStaff(code);
      if (record.status !== 'SUBMITTED') {
        setPreRegError(
          PRE_REGISTRATION_STATUS_MESSAGES[record.status] ?? `This drop-off cannot be loaded (status: ${record.status}).`,
        );
        return;
      }
      applyPreRegistration(record);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        setPreRegError('No prepared drop-off found for that reference.');
      } else {
        setPreRegError(err instanceof ApiError ? err.message : 'Failed to look up that reference.');
      }
    } finally {
      setPreRegLoading(false);
    }
  }

  /** USB/Bluetooth HID scanners "type" the payload then send Enter — same convention as ScanInput elsewhere in Warehouse. No click needed after a scan. */
  function handlePreRegKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadPreRegistration();
    }
  }

  function clearLoadedPreRegistration() {
    setLoadedPreReg(null);
    setPreRegError(null);
  }

  const selectedOriginWarehouse = warehouses?.find((warehouse) => warehouse.id === originWarehouseId) ?? null;
  const originGeographyLabel = selectedOriginWarehouse
    ? [selectedOriginWarehouse.city, selectedOriginWarehouse.state, selectedOriginWarehouse.country].filter(Boolean).join(', ')
    : null;

  /**
   * Root cause of the Gold Coast pickup bug (2026-09-29): this field used
   * to list every warehouse unfiltered, so a tenant with only one
   * warehouse (origin-only) had no way to leave this "optional" field
   * meaningfully empty — the only selectable option WAS the origin
   * warehouse. Filtering to isDestinationWarehouse here means an
   * origin-only warehouse can never again be recorded as a shipment's
   * destinationWarehouseId through this form (the backend now also
   * independently rejects it — see ShipmentsService.createQuickReceive).
   */
  const destinationWarehouseOptions = warehouses?.filter((warehouse) => warehouse.isDestinationWarehouse) ?? [];

  /** Clears a single field's stale error as soon as the user changes it, rather than leaving it on screen until the next submit re-runs validate(). */
  function clearFieldError(field: string) {
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function setRecipientField(field: keyof ReturnType<typeof emptyRecipient>, value: string) {
    setRecipient((prev) => ({ ...prev, [field]: value }));
    clearFieldError(field);
  }

  async function submitNewCustomer(confirmDuplicate: boolean) {
    setCustomerError(null);
    if (!newFirstName.trim() || !newLastName.trim() || !newEmail.trim()) {
      setCustomerError('First name, last name, and email are required.');
      return;
    }
    setCreatingCustomer(true);
    try {
      const customer = await createCustomer({
        firstName: newFirstName.trim(),
        lastName: newLastName.trim(),
        email: newEmail.trim(),
        phone: newPhone.trim() || undefined,
        confirmDuplicate,
      });
      // Newly created customer is added to the same list SearchableSelect
      // already renders, and immediately selected — no page navigation, no
      // re-fetch, no leaving Quick Receive.
      setCustomers((prev) => [customer, ...prev]);
      setCustomerId(customer.id);
      setShowNewCustomer(false);
      setDuplicateMatches(null);
      setNewFirstName('');
      setNewLastName('');
      setNewEmail('');
      setNewPhone('');
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        const body = err.details as DuplicateCustomerErrorBody | undefined;
        setDuplicateMatches(body?.duplicates ?? []);
        setCustomerError(body?.message ?? 'A matching customer may already exist.');
      } else {
        setCustomerError(err instanceof ApiError ? err.message : 'Failed to create customer.');
      }
    } finally {
      setCreatingCustomer(false);
    }
  }

  function selectDuplicateCustomer(customer: CustomerSummary) {
    setCustomers((prev) => (prev.some((existing) => existing.id === customer.id) ? prev : [customer, ...prev]));
    setCustomerId(customer.id);
    setShowNewCustomer(false);
    setDuplicateMatches(null);
    setCustomerError(null);
    setNewFirstName('');
    setNewLastName('');
    setNewEmail('');
    setNewPhone('');
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!customerId) errors.customerId = 'Search for an existing customer or create a new one.';
    if (!originWarehouseId) errors.originWarehouseId = 'Select the origin warehouse these packages are physically at.';
    if (!destinationCountry.trim()) errors.destinationCountry = 'Destination country is required.';
    if (!recipient.recipientName.trim()) errors.recipientName = "Enter the recipient's full name.";
    if (!recipient.recipientPhone.trim()) errors.recipientPhone = "Enter the recipient's phone number.";
    if (!Number.isInteger(packageCount) || packageCount < 1 || packageCount > 50) {
      errors.packageCount = 'Number of packages must be between 1 and 50.';
    }
    if (weight && (!Number.isFinite(Number(weight)) || Number(weight) <= 0)) {
      errors.weight = 'Weight must be a positive number.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!validate()) {
      setError('Fix the highlighted fields before receiving these packages.');
      return;
    }
    if (submitting) return; // guards a double-Enter/double-click racing this same handler
    setSubmitting(true);
    try {
      const shipment = await createQuickReceive({
        customerId,
        shipmentMode,
        destinationCountry: destinationCountry.trim(),
        destinationLocation: destinationLocation.trim() || undefined,
        originWarehouseId,
        destinationWarehouseId: destinationWarehouseId || undefined,
        description: description.trim() || undefined,
        recipientName: recipient.recipientName.trim(),
        recipientPhone: recipient.recipientPhone.trim(),
        recipientEmail: recipient.recipientEmail.trim() || undefined,
        recipientAddressLine1: recipient.recipientAddressLine1.trim() || undefined,
        recipientAddressLine2: recipient.recipientAddressLine2.trim() || undefined,
        recipientCity: recipient.recipientCity.trim() || undefined,
        recipientState: recipient.recipientState.trim() || undefined,
        recipientCountry: recipient.recipientCountry.trim() || undefined,
        recipientPostalCode: recipient.recipientPostalCode.trim() || undefined,
        packageCount,
        itemType,
        itemDescription: itemDescription.trim() || undefined,
        weight: weight ? Number(weight) : undefined,
        weightUnit,
        notes: notes.trim() || undefined,
        preRegistrationId: loadedPreReg?.id,
      });
      setReceipt(shipment);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403) {
        setError("You don't have permission to receive packages. Contact an owner or manager.");
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to receive packages. Nothing was created — you can retry.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handlePrintLabels() {
    if (!receipt) return;
    window.open(`/dashboard/shipments/${receipt.id}/labels`, '_blank', 'noopener');
  }

  function handleReceiveAnother() {
    const keepOriginWarehouseId = originWarehouseId;
    setReceipt(null);
    setCustomerId('');
    setCustomers([]);
    setDestinationCountry('');
    setDestinationLocation('');
    setDestinationWarehouseId('');
    setDescription('');
    setRecipient(emptyRecipient());
    setShowRecipientAddress(false);
    setPackageCount(1);
    setItemType(ShipmentItemType.BOX);
    setItemDescription('');
    setWeight('');
    setWeightUnit(WeightUnit.LB);
    setNotes('');
    setShowNewCustomer(false);
    setDuplicateMatches(null);
    setCustomerError(null);
    setFieldErrors({});
    setError(null);
    setLoadedPreReg(null);
    setPreRegCode('');
    setPreRegError(null);
    setOriginWarehouseId(keepOriginWarehouseId); // static for a receiving session — re-picking it every time is the friction Receive Another exists to remove
    setFormInstanceKey((key) => key + 1); // remounts the customer field so autoFocus re-fires
  }

  if (authLoading || !user) {
    return <LoadingScreen />;
  }

  if (receipt) {
    return (
      <div className="max-w-3xl">
        <Card className="mt-6">
          <div className="flex flex-col items-start gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">
                Received {receipt.itemCounts?.total ?? packageCount} package{(receipt.itemCounts?.total ?? packageCount) === 1 ? '' : 's'}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {receipt.customer ? `${receipt.customer.firstName} ${receipt.customer.lastName} — ` : ''}
                Tracking <span className="font-medium text-slate-700">{receipt.trackingNumber}</span>
              </p>
              {loadedPreReg && (
                <p className="mt-1 text-xs text-slate-400">
                  Converted from prepared drop-off {loadedPreReg.referenceNumber}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Button onClick={handlePrintLabels}>Print Labels</Button>
              <Button variant="secondary" onClick={handleReceiveAnother}>
                Receive Another
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Quick Receive</h1>
      <p className="mt-1 text-sm text-slate-500">
        Create a shipment and receive all its packages in one step — no scanning required. Tracking numbers and item
        codes are assigned automatically, and every package is marked received at the warehouse you select below.
      </p>

      <SendDropoffLinkCard />

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-slate-900">Customer has a Prepared Drop-Off?</h2>
        <p className="mt-1 text-xs text-slate-500">Scan the customer&apos;s QR code or enter their reference number.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="flex-1">
            <label htmlFor="preRegCode" className="sr-only">
              Scan or enter PRE reference
            </label>
            <input
              id="preRegCode"
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="Scan or enter PRE reference"
              value={preRegCode}
              disabled={preRegLoading}
              onChange={(event) => {
                setPreRegCode(event.target.value);
                if (preRegError) setPreRegError(null);
              }}
              onKeyDown={handlePreRegKeyDown}
              className="w-full rounded-lg border-2 border-primary-200 bg-white px-4 py-2.5 font-mono text-sm tracking-wide text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:bg-slate-50"
            />
          </div>
          <Button type="button" variant="secondary" disabled={preRegLoading || !preRegCode.trim()} onClick={loadPreRegistration}>
            {preRegLoading ? 'Loading…' : 'Load Drop-Off'}
          </Button>
        </div>
        {preRegError && (
          <p role="alert" className="mt-2 text-sm font-medium text-amber-700">
            {preRegError}
          </p>
        )}
        {loadedPreReg && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm text-emerald-800">
              Loaded <span className="font-mono font-semibold">{loadedPreReg.referenceNumber}</span> —{' '}
              {loadedPreReg.customer.firstName} {loadedPreReg.customer.lastName}. Verify the details below against what
              physically arrived.
            </p>
            <button
              type="button"
              onClick={clearLoadedPreRegistration}
              className="shrink-0 text-sm font-medium text-emerald-700 hover:text-emerald-900"
            >
              Clear
            </button>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <form className="flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
          <div>
            <div className="flex items-end justify-between gap-3">
              <div className="flex-1">
                <SearchableSelect
                  key={formInstanceKey}
                  label="Customer"
                  id="customerId"
                  required
                  autoFocus
                  placeholder={`Type at least ${CUSTOMER_SEARCH_MIN_CHARS} characters — name, customer number, email, or phone…`}
                  items={customers}
                  value={customerId}
                  onChange={(id) => {
                    setCustomerId(id);
                    clearFieldError('customerId');
                  }}
                  onQueryChange={searchCustomers}
                  getOptionId={(customer) => customer.id}
                  getOptionLabel={(customer) => `${customer.customerNumber} — ${customer.firstName} ${customer.lastName}`}
                  getOptionSearchText={(customer) =>
                    `${customer.customerNumber} ${customer.firstName} ${customer.lastName} ${customer.email} ${customer.phone ?? ''}`
                  }
                  emptyMessage={customerSearching ? 'Searching…' : 'No matching customers.'}
                />
                {fieldErrors.customerId && <p className="mt-1 text-xs text-red-600">{fieldErrors.customerId}</p>}
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowNewCustomer((open) => !open);
                  setDuplicateMatches(null);
                  setCustomerError(null);
                }}
                className="shrink-0"
              >
                {showNewCustomer ? 'Cancel' : '+ New Customer'}
              </Button>
            </div>

            {showNewCustomer && (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextInput
                    label="First name"
                    id="newFirstName"
                    required
                    value={newFirstName}
                    onChange={(event) => setNewFirstName(event.target.value)}
                  />
                  <TextInput
                    label="Last name"
                    id="newLastName"
                    required
                    value={newLastName}
                    onChange={(event) => setNewLastName(event.target.value)}
                  />
                  <TextInput
                    label="Email"
                    id="newEmail"
                    type="email"
                    required
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                  />
                  <TextInput
                    label="Phone"
                    id="newPhone"
                    value={newPhone}
                    onChange={(event) => setNewPhone(event.target.value)}
                  />
                </div>
                {customerError && (
                  <p role="alert" className="text-sm text-red-600">
                    {customerError}
                  </p>
                )}
                {duplicateMatches && duplicateMatches.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <p className="text-xs font-medium text-amber-800">Possible existing match — use this customer instead?</p>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {duplicateMatches.map((match) => (
                        <li key={match.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-slate-700">
                            {match.customerNumber} — {match.firstName} {match.lastName} ({match.email}
                            {match.phone ? `, ${match.phone}` : ''})
                          </span>
                          <Button type="button" variant="secondary" onClick={() => selectDuplicateCustomer(match)}>
                            Use this customer
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3"
                      disabled={creatingCustomer}
                      onClick={() => submitNewCustomer(true)}
                    >
                      {creatingCustomer ? 'Creating…' : 'No — this is a different person, create anyway'}
                    </Button>
                  </div>
                )}
                {!duplicateMatches && (
                  <Button
                    type="button"
                    onClick={() => submitNewCustomer(false)}
                    disabled={creatingCustomer}
                    className="self-start"
                  >
                    {creatingCustomer ? 'Creating…' : 'Create & Select Customer'}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectInput
              label="Shipping method"
              id="shipmentMode"
              required
              value={shipmentMode}
              onChange={(event) => setShipmentMode(event.target.value as ShipmentMode)}
            >
              {Object.values(ShipmentMode).map((mode) => (
                <option key={mode} value={mode}>
                  {humanizeEnumValue(mode)}
                </option>
              ))}
            </SelectInput>
            {warehouses === null ? (
              <p className="self-end pb-2.5 text-sm text-slate-500">Loading warehouses…</p>
            ) : (
              <div>
                <SelectInput
                  label="Origin warehouse (where these packages are now)"
                  id="originWarehouseId"
                  required
                  value={originWarehouseId}
                  onChange={(event) => {
                    setOriginWarehouseId(event.target.value);
                    clearFieldError('originWarehouseId');
                  }}
                >
                  {warehouses.length === 0 && <option value="">No warehouses configured</option>}
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} ({warehouse.code})
                    </option>
                  ))}
                </SelectInput>
                {fieldErrors.originWarehouseId && <p className="mt-1 text-xs text-red-600">{fieldErrors.originWarehouseId}</p>}
                {originGeographyLabel && (
                  <p className="mt-1 text-xs text-slate-500">Origin: {originGeographyLabel} (from this warehouse&apos;s address)</p>
                )}
              </div>
            )}
            <div>
              <TextInput
                label="Destination country"
                id="destinationCountry"
                required
                value={destinationCountry}
                onChange={(event) => {
                  setDestinationCountry(event.target.value);
                  clearFieldError('destinationCountry');
                }}
              />
              {fieldErrors.destinationCountry && <p className="mt-1 text-xs text-red-600">{fieldErrors.destinationCountry}</p>}
            </div>
            <TextInput
              label="Destination location"
              id="destinationLocation"
              placeholder="City, port, or airport"
              value={destinationLocation}
              onChange={(event) => setDestinationLocation(event.target.value)}
            />
            {warehouses !== null && destinationWarehouseOptions.length > 0 && (
              <SelectInput
                label="Destination warehouse (optional)"
                id="destinationWarehouseId"
                value={destinationWarehouseId}
                onChange={(event) => setDestinationWarehouseId(event.target.value)}
              >
                <option value="">Not yet known / no destination warehouse</option>
                {destinationWarehouseOptions.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name} ({warehouse.code})
                  </option>
                ))}
              </SelectInput>
            )}
            {warehouses !== null && warehouses.length > 0 && destinationWarehouseOptions.length === 0 && (
              <p className="text-xs text-slate-500">
                No destination warehouse is configured yet — destination country/location above stays staff-entered
                free text until one exists.{' '}
                <Link href="/dashboard/settings/warehouses" className="text-primary-700 underline">
                  Configure a destination warehouse
                </Link>
                .
              </p>
            )}
          </div>
          <TextArea
            label="Shipment description"
            id="description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">Recipient (who is receiving this at destination)</h2>
            <p className="mt-1 text-xs text-slate-500">
              May be different from the customer shipping these packages. Captured once per shipment.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <TextInput
                  label="Recipient full name"
                  id="recipientName"
                  required
                  value={recipient.recipientName}
                  onChange={(event) => setRecipientField('recipientName', event.target.value)}
                />
                {fieldErrors.recipientName && <p className="mt-1 text-xs text-red-600">{fieldErrors.recipientName}</p>}
              </div>
              <div>
                <TextInput
                  label="Recipient phone"
                  id="recipientPhone"
                  required
                  placeholder="Include country code, e.g. +233…"
                  value={recipient.recipientPhone}
                  onChange={(event) => setRecipientField('recipientPhone', event.target.value)}
                />
                {fieldErrors.recipientPhone && <p className="mt-1 text-xs text-red-600">{fieldErrors.recipientPhone}</p>}
              </div>
              <TextInput
                label="Recipient email (optional)"
                id="recipientEmail"
                type="email"
                value={recipient.recipientEmail}
                onChange={(event) => setRecipientField('recipientEmail', event.target.value)}
              />
            </div>
            {!showRecipientAddress ? (
              <button
                type="button"
                className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-700"
                onClick={() => setShowRecipientAddress(true)}
              >
                + Add recipient address (optional)
              </button>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextInput
                  label="Address line 1"
                  id="recipientAddressLine1"
                  value={recipient.recipientAddressLine1}
                  onChange={(event) => setRecipientField('recipientAddressLine1', event.target.value)}
                />
                <TextInput
                  label="Address line 2"
                  id="recipientAddressLine2"
                  value={recipient.recipientAddressLine2}
                  onChange={(event) => setRecipientField('recipientAddressLine2', event.target.value)}
                />
                <TextInput
                  label="City"
                  id="recipientCity"
                  value={recipient.recipientCity}
                  onChange={(event) => setRecipientField('recipientCity', event.target.value)}
                />
                <TextInput
                  label="State / province / region"
                  id="recipientState"
                  value={recipient.recipientState}
                  onChange={(event) => setRecipientField('recipientState', event.target.value)}
                />
                <TextInput
                  label="Country"
                  id="recipientCountry"
                  value={recipient.recipientCountry}
                  onChange={(event) => setRecipientField('recipientCountry', event.target.value)}
                />
                <TextInput
                  label="Postal code"
                  id="recipientPostalCode"
                  value={recipient.recipientPostalCode}
                  onChange={(event) => setRecipientField('recipientPostalCode', event.target.value)}
                />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">Packages</h2>
            <p className="mt-1 text-xs text-slate-500">
              Applies to every package in this intake. A single odd-one-out package can be edited individually
              afterward from the shipment detail page.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <TextInput
                  label="Number of pieces/packages"
                  id="packageCount"
                  type="number"
                  min={1}
                  max={50}
                  required
                  value={String(packageCount)}
                  onChange={(event) => {
                    setPackageCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)));
                    clearFieldError('packageCount');
                  }}
                />
                {fieldErrors.packageCount && <p className="mt-1 text-xs text-red-600">{fieldErrors.packageCount}</p>}
              </div>
              <SelectInput
                label="Package type"
                id="itemType"
                value={itemType}
                onChange={(event) => setItemType(event.target.value as ShipmentItemType)}
              >
                {Object.values(ShipmentItemType).map((type) => (
                  <option key={type} value={type}>
                    {humanizeEnumValue(type)}
                  </option>
                ))}
              </SelectInput>
              <TextInput
                label="Package description"
                id="itemDescription"
                value={itemDescription}
                onChange={(event) => setItemDescription(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <TextInput
                    label="Weight (each)"
                    id="weight"
                    type="number"
                    value={weight}
                    onChange={(event) => {
                      setWeight(event.target.value);
                      clearFieldError('weight');
                    }}
                  />
                  {fieldErrors.weight && <p className="mt-1 text-xs text-red-600">{fieldErrors.weight}</p>}
                </div>
                <SelectInput
                  label="Unit"
                  id="weightUnit"
                  value={weightUnit}
                  onChange={(event) => setWeightUnit(event.target.value as WeightUnit)}
                >
                  {Object.values(WeightUnit).map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </SelectInput>
              </div>
            </div>
            <TextArea
              label="Notes for the warehouse (optional)"
              id="notes"
              rows={2}
              className="mt-3"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? 'Receiving…' : `Receive ${packageCount} Package${packageCount === 1 ? '' : 's'}`}
          </Button>
        </form>
      </Card>
    </div>
  );
}
