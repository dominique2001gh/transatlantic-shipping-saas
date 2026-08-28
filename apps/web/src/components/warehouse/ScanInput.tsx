'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconSearch } from '@/components/icons';

/**
 * Reusable scan-input field for any warehouse operation mode. USB and
 * Bluetooth barcode scanners behave as keyboard-emulation (HID) devices —
 * they "type" the scanned payload into whatever text input has focus,
 * then send Enter. This component only needs to stay focused and submit
 * on Enter; no scanner-specific driver/SDK integration is required, and
 * the exact same input works for a barcode payload, a QR payload, or a
 * hand-typed itemCode.
 *
 * Camera-based scanning (phone/tablet) is a distinct input source not
 * built in this milestone — it would decode a QR from the video stream
 * and call this same `onSubmit` callback with the decoded text, so this
 * component's boundary is deliberately where that capability would plug
 * in later without changing anything downstream of it.
 */
export function ScanInput({
  onSubmit,
  disabled,
  placeholder = 'Scan or type a code, then press Enter',
  autoFocusKey,
}: {
  onSubmit: (code: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Bump this value (e.g. after a successful scan) to refocus the input for the next item. */
  autoFocusKey?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [autoFocusKey, disabled]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const trimmed = value.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setValue('');
      }
    }
  }

  return (
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
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-lg border-2 border-primary-200 bg-white py-4 pl-11 pr-4 text-lg font-mono tracking-wide text-slate-900 placeholder:text-base placeholder:font-sans placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:bg-slate-50"
      />
    </div>
  );
}
