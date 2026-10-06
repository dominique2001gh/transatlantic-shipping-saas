'use client';

import { useState } from 'react';
import { PERMISSION_GROUPS, PERMISSION_LABELS, PERMISSION_PRESET_OPTIONS } from '@transatlantic/shared';
import type { PermissionKey, PermissionPresetUiKey, UserRole } from '@transatlantic/shared';
import { Checkbox } from '@/components/forms/FormField';

/**
 * RBAC permissions UI (Phase D): the one picker used by both the Staff
 * Invite form and the Edit Permissions flow for an existing staff member
 * — preset buttons first (a convenient starting point, per
 * PERMISSION_PRESET_OPTIONS), then the full grouped checkbox grid built
 * straight from PERMISSION_GROUPS/PERMISSION_LABELS (the Phase B/C source
 * of truth) so this can never drift from what the backend actually
 * enforces. Picking a preset is never a one-way lock-in — any individual
 * checkbox can still be toggled afterward (clearing the preset highlight,
 * since it's then a custom mix, not that exact preset anymore).
 *
 * This component only ever produces a plain `PermissionKey[]` for the
 * parent to send to the API — it has no knowledge of OWNER, self-
 * escalation, or cross-tenant rules. The backend (PermissionsGuard,
 * UsersService) is what actually enforces all of that; this is UI
 * convenience only, matching every other role/permission check already
 * documented as such across this app's frontend.
 */
export function PermissionsPicker({
  value,
  onChange,
  onPresetSelect,
  disabledKeys,
  readOnly,
}: {
  value: PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  /** Called when a preset implies a default Role — the invite form uses this to keep its separate Role field in sync. The owner can still override it afterward. */
  onPresetSelect?: (role: UserRole) => void;
  /** Permissions the person configuring this does NOT themselves hold — rendered disabled, mirroring the backend rule that a non-owner can never grant authority they don't have themselves. Omit for an OWNER caller, who has no such restriction. */
  disabledKeys?: ReadonlySet<string>;
  /** Renders every control disabled — e.g. a viewer without staff.permissions looking at someone else's grants. */
  readOnly?: boolean;
}) {
  const [activePreset, setActivePreset] = useState<PermissionPresetUiKey | null>(null);

  function applyPreset(option: (typeof PERMISSION_PRESET_OPTIONS)[number]) {
    setActivePreset(option.key);
    onChange(option.permissions);
    if (option.defaultRole) onPresetSelect?.(option.defaultRole);
  }

  function toggle(key: PermissionKey) {
    setActivePreset(null);
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {PERMISSION_PRESET_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            disabled={readOnly}
            onClick={() => applyPreset(option)}
            title={option.description}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              activePreset === option.key
                ? 'border-primary-700 bg-primary-50 text-primary-800'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {activePreset && (
        <p className="mt-2 text-xs text-slate-500">{PERMISSION_PRESET_OPTIONS.find((o) => o.key === activePreset)?.description}</p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {PERMISSION_GROUPS.map((group) => (
          <fieldset key={group.label} className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</legend>
            {group.keys.map((key) => (
              <Checkbox
                key={key}
                id={`perm-${key}`}
                label={PERMISSION_LABELS[key]}
                checked={value.includes(key)}
                disabled={readOnly || disabledKeys?.has(key)}
                onChange={() => toggle(key)}
              />
            ))}
          </fieldset>
        ))}
      </div>
    </div>
  );
}
