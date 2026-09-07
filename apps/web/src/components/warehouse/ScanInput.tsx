'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconSearch } from '@/components/icons';
import { playScanErrorTone } from '@/lib/scan-feedback';

/**
 * Reusable scan-input field for any warehouse operation mode. USB,
 * 2.4GHz, and Bluetooth barcode/QR scanners all behave as keyboard-
 * emulation (HID) devices — they "type" the scanned payload into whatever
 * text input has focus, then send Enter, indistinguishably from a human
 * typing fast and pressing Enter. This component only needs to stay
 * focused and submit on Enter; no scanner-specific driver/SDK/vendor
 * integration is required or assumed, and the exact same input works for
 * a barcode payload, a QR payload, a hand-typed itemCode, or whatever
 * physical 2D scanner hardware ends up on the floor.
 *
 * Camera-based scanning (phone/tablet) is a distinct input source not
 * built in this milestone — it would decode a QR from the video stream
 * and call this same `onSubmit` callback with the decoded text, so this
 * component's boundary is deliberately where that capability would plug
 * in later without changing anything downstream of it.
 *
 * Phase 3 (hardware acceptance): refocuses after every submit — including
 * a caller-detected duplicate (see `onDuplicate` below) — not just on
 * error, so a continuous scan-scan-scan-scan sequence never requires
 * touching the mouse or keyboard, regardless of whether each scan
 * succeeds, fails, or is rejected as a dupe.
 */
export function ScanInput({
  onSubmit,
  disabled,
  placeholder = 'Scan or type a code, then press Enter',
  autoFocusKey,
  onDuplicate,
}: {
  onSubmit: (code: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Bump this value (e.g. after a successful scan) to refocus the input for the next item. */
  autoFocusKey?: number;
  /**
   * Optional client-side duplicate check, run before `onSubmit` on every
   * submitted code. Return a non-empty warning message to intercept the
   * scan entirely — ScanInput shows that message inline itself and never
   * calls `onSubmit`, so an operator re-scanning the same package (a
   * common real-world slip, not just a hardware double-fire) gets instant
   * feedback with zero network round-trip, and the input is immediately
   * ready for the next scan. Callers decide what "duplicate" means for
   * their own mode (already-received this session, already loaded on this
   * container, etc.) — this component has no opinion on that.
   */
  onDuplicate?: (code: string) => string | undefined;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [autoFocusKey, disabled]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const trimmed = value.trim();
      if (!trimmed) return;

      const duplicateMessage = onDuplicate?.(trimmed);
      setValue('');
      if (duplicateMessage) {
        setDuplicateWarning(duplicateMessage);
        playScanErrorTone();
        return;
      }
      setDuplicateWarning(null);
      onSubmit(trimmed);
    }
  }

  return (
    <div>
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <label htmlFor="scanInput" className="sr-only">
          Scan or enter a code
        </label>
        <input
          ref={inputRef}
          id="scanInput"
          type="text"
          inputMode="text"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (duplicateWarning) setDuplicateWarning(null);
          }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-lg border-2 border-primary-200 bg-white py-4 pl-11 pr-4 text-lg font-mono tracking-wide text-slate-900 placeholder:text-base placeholder:font-sans placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:bg-slate-50"
        />
      </div>
      {duplicateWarning && (
        <p role="alert" className="mt-1.5 text-sm font-medium text-amber-700">
          {duplicateWarning}
        </p>
      )}
    </div>
  );
}
