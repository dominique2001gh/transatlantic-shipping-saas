export type WarehouseMode = 'RECEIVE' | 'PROCESS' | 'LOAD' | 'DESTINATION_RECEIVE' | 'PICKUP_DELIVERY';

interface ModeOption {
  key: WarehouseMode;
  label: string;
  available: boolean;
}

/**
 * RECEIVE (3B), PROCESS (3C), LOAD (3D), DESTINATION_RECEIVE (3F), and
 * PICKUP_DELIVERY (Customer Pickup milestone) are implemented.
 * PICKUP_DELIVERY currently only implements Customer Pickup — Delivery /
 * Driver / Dispatch is a separate, later milestone that will build inside
 * this same tab, not a new one, once Customer Pickup has been verified.
 */
const MODES: ModeOption[] = [
  { key: 'RECEIVE', label: 'Receive', available: true },
  { key: 'PROCESS', label: 'Process / Inspect', available: true },
  { key: 'LOAD', label: 'Load Container', available: true },
  { key: 'DESTINATION_RECEIVE', label: 'Destination Receive', available: true },
  { key: 'PICKUP_DELIVERY', label: 'Pickup / Delivery', available: true },
];

export function ModeSelector({
  mode,
  onChange,
}: {
  mode: WarehouseMode;
  onChange: (mode: WarehouseMode) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Warehouse operation mode">
      {MODES.map((option) => (
        <button
          key={option.key}
          type="button"
          role="tab"
          aria-selected={mode === option.key}
          disabled={!option.available}
          onClick={() => option.available && onChange(option.key)}
          title={option.available ? undefined : 'Coming in a future milestone'}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            mode === option.key
              ? 'bg-primary-700 text-white'
              : option.available
                ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                : 'cursor-not-allowed bg-slate-100 text-slate-400'
          }`}
        >
          {option.label}
          {!option.available && <span className="ml-1.5 text-[10px] uppercase tracking-wide">Soon</span>}
        </button>
      ))}
    </div>
  );
}
