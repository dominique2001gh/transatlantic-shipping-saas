'use client';

import { useState } from 'react';
import type { ManifestDetail, WarehouseSummary } from '@transatlantic/shared';
import { ShipmentMode } from '@transatlantic/shared';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { createManifest } from '@/lib/manifests';

/** Container-based modes — mirrors OCEAN_RORO_MODES in ManifestsService exactly. */
const OCEAN_MODES = new Set<ShipmentMode>([ShipmentMode.OCEAN_LCL, ShipmentMode.OCEAN_FCL, ShipmentMode.RORO]);

const MODE_OPTIONS: { value: ShipmentMode; label: string }[] = [
  { value: ShipmentMode.OCEAN_FCL, label: 'Ocean · FCL' },
  { value: ShipmentMode.OCEAN_LCL, label: 'Ocean · LCL' },
  { value: ShipmentMode.RORO, label: 'Ocean · RoRo' },
  { value: ShipmentMode.AIR, label: 'Air' },
];

/**
 * Fields required to *finalize* mirror ManifestsService.finalize's own
 * validation exactly (carrierName; vesselName+voyageNumber for Ocean/RoRo,
 * flightNumber for Air; an origin — warehouse or free text; destination).
 * Requiring them up front at creation avoids booking a manifest that can
 * never be finalized, while the backend remains the authority — it still
 * re-validates independently at finalize time.
 */
function validate(input: {
  shipmentMode: ShipmentMode;
  originWarehouseId: string;
  originLocation: string;
  destinationLocation: string;
  carrierName: string;
  vesselName: string;
  voyageNumber: string;
  flightNumber: string;
}): string[] {
  const errors: string[] = [];
  const isOcean = OCEAN_MODES.has(input.shipmentMode);

  if (!input.carrierName.trim()) errors.push('Carrier is required.');
  if (isOcean) {
    if (!input.vesselName.trim()) errors.push('Vessel name is required for an Ocean/RoRo manifest.');
    if (!input.voyageNumber.trim()) errors.push('Voyage number is required for an Ocean/RoRo manifest.');
  } else if (!input.flightNumber.trim()) {
    errors.push('Flight number is required for an Air manifest.');
  }
  if (!input.originWarehouseId && !input.originLocation.trim()) {
    errors.push('Select an origin warehouse or enter an origin location.');
  }
  if (!input.destinationLocation.trim()) errors.push('Destination is required.');

  return errors;
}

export function CreateManifestForm({
  warehouses,
  onCreated,
  onCancel,
}: {
  warehouses: WarehouseSummary[];
  onCreated: (manifest: ManifestDetail) => void;
  onCancel: () => void;
}) {
  const [shipmentMode, setShipmentMode] = useState<ShipmentMode>(ShipmentMode.OCEAN_FCL);
  const [originWarehouseId, setOriginWarehouseId] = useState('');
  const [originLocation, setOriginLocation] = useState('');
  const [destinationLocation, setDestinationLocation] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [vesselName, setVesselName] = useState('');
  const [voyageNumber, setVoyageNumber] = useState('');
  const [flightNumber, setFlightNumber] = useState('');
  const [plannedDepartureAt, setPlannedDepartureAt] = useState('');
  const [estimatedArrivalAt, setEstimatedArrivalAt] = useState('');

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const isOcean = OCEAN_MODES.has(shipmentMode);

  async function handleSubmit() {
    const errors = validate({
      shipmentMode,
      originWarehouseId,
      originLocation,
      destinationLocation,
      carrierName,
      vesselName,
      voyageNumber,
      flightNumber,
    });
    setValidationErrors(errors);
    if (errors.length > 0) return;

    setSubmitError(null);
    setCreating(true);
    try {
      const manifest = await createManifest({
        shipmentMode,
        originWarehouseId: originWarehouseId || undefined,
        originLocation: originLocation.trim() || undefined,
        destinationLocation: destinationLocation.trim(),
        carrierName: carrierName.trim(),
        vesselName: isOcean ? vesselName.trim() || undefined : undefined,
        voyageNumber: isOcean ? voyageNumber.trim() || undefined : undefined,
        flightNumber: !isOcean ? flightNumber.trim() || undefined : undefined,
        plannedDepartureAt: plannedDepartureAt || undefined,
        estimatedArrivalAt: estimatedArrivalAt || undefined,
      });
      onCreated(manifest);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Failed to create manifest.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-primary-200 bg-primary-50/40 p-5">
      <h3 className="text-sm font-semibold text-slate-900">New manifest</h3>

      <div className="mt-3">
        <span className="text-xs font-medium text-slate-600">Mode</span>
        <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Manifest mode">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={shipmentMode === option.value}
              onClick={() => setShipmentMode(option.value)}
              className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                shipmentMode === option.value
                  ? 'bg-primary-700 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="manifestOriginWarehouse" className="text-xs font-medium text-slate-600">
            Origin warehouse
          </label>
          <select
            id="manifestOriginWarehouse"
            value={originWarehouseId}
            onChange={(event) => setOriginWarehouseId(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">— None / use origin location below —</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name} ({warehouse.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="manifestOriginLocation" className="text-xs font-medium text-slate-600">
            Origin location {originWarehouseId ? '(optional)' : ''}
          </label>
          <input
            id="manifestOriginLocation"
            value={originLocation}
            onChange={(event) => setOriginLocation(event.target.value)}
            placeholder="e.g. Port of Miami, FL"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <div>
          <label htmlFor="manifestDestination" className="text-xs font-medium text-slate-600">
            Destination location
          </label>
          <input
            id="manifestDestination"
            value={destinationLocation}
            onChange={(event) => setDestinationLocation(event.target.value)}
            placeholder="e.g. Tema Port, Ghana"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div>
          <label htmlFor="manifestCarrier" className="text-xs font-medium text-slate-600">
            Carrier
          </label>
          <input
            id="manifestCarrier"
            value={carrierName}
            onChange={(event) => setCarrierName(event.target.value)}
            placeholder="e.g. Maersk"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        {isOcean ? (
          <>
            <div>
              <label htmlFor="manifestVessel" className="text-xs font-medium text-slate-600">
                Vessel name
              </label>
              <input
                id="manifestVessel"
                value={vesselName}
                onChange={(event) => setVesselName(event.target.value)}
                placeholder="e.g. MSC Gaia"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label htmlFor="manifestVoyage" className="text-xs font-medium text-slate-600">
                Voyage number
              </label>
              <input
                id="manifestVoyage"
                value={voyageNumber}
                onChange={(event) => setVoyageNumber(event.target.value)}
                placeholder="e.g. 341W"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </>
        ) : (
          <div>
            <label htmlFor="manifestFlight" className="text-xs font-medium text-slate-600">
              Flight number
            </label>
            <input
              id="manifestFlight"
              value={flightNumber}
              onChange={(event) => setFlightNumber(event.target.value)}
              placeholder="e.g. DL201"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        )}

        <div>
          <label htmlFor="manifestPlannedDeparture" className="text-xs font-medium text-slate-600">
            Planned departure (optional)
          </label>
          <input
            id="manifestPlannedDeparture"
            type="datetime-local"
            value={plannedDepartureAt}
            onChange={(event) => setPlannedDepartureAt(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div>
          <label htmlFor="manifestEstimatedArrival" className="text-xs font-medium text-slate-600">
            Estimated arrival (optional)
          </label>
          <input
            id="manifestEstimatedArrival"
            type="datetime-local"
            value={estimatedArrivalAt}
            onChange={(event) => setEstimatedArrivalAt(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      {validationErrors.length > 0 && (
        <ul role="alert" className="mt-3 list-inside list-disc rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {validationErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {submitError && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {submitError}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="button" onClick={handleSubmit} disabled={creating}>
          {creating ? 'Creating…' : 'Create manifest'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={creating}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
