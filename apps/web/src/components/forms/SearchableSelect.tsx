'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { FieldLabel, fieldClasses } from './FormField';
import { filterSearchableOptions } from '@/lib/searchable-select';

export interface SearchableSelectProps<T> {
  id: string;
  label: string;
  required?: boolean;
  /** Keeps the label in the accessibility tree without reserving visual space — matches TextInput's own hideLabel. */
  hideLabel?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /**
   * The full option list, already fetched by the caller (e.g. a plain
   * `listCustomers()` call on mount) — this component never fetches
   * anything itself and never knows about tenants, APIs, or auth. That's
   * deliberate: whatever tenant-scoping the caller's own fetch already
   * has (see lib/customers.ts's own tenant-scoped /customers endpoint)
   * is inherited for free, with zero risk of this component introducing
   * a second, differently-scoped data path.
   */
  items: T[];
  /** Selected option's id, or '' for no selection — same contract as a native <select value>. */
  value: string;
  onChange: (id: string, item: T | undefined) => void;
  getOptionId: (item: T) => string;
  /** Also the text written into the field once an option is selected. */
  getOptionLabel: (item: T) => string;
  /** What typed queries are matched against — defaults to getOptionLabel when omitted. Pass a string combining every field that should be searchable (e.g. name + customer number + email + phone). */
  getOptionSearchText?: (item: T) => string;
  /** Customize each dropdown row's contents; defaults to plain getOptionLabel text. */
  renderOption?: (item: T, state: { highlighted: boolean; selected: boolean }) => ReactNode;
  emptyMessage?: string;
  /** Caps how many matches render at once, so a large tenant customer list never dumps thousands of DOM nodes into the popup. */
  maxResults?: number;
  className?: string;
}

/**
 * Generic searchable combobox/autocomplete — a drop-in replacement for
 * SelectInput (see FormField.tsx) wherever the option list is a lookup by
 * id against a potentially long, growing list (customers, and later
 * warehouses/staff/etc. in invoices, payments, manifests) rather than a
 * small fixed enum. Built once, generically, so every one of those
 * pickers shares this exact accessible implementation instead of each
 * page copy-pasting its own combobox logic.
 *
 * Filtering is entirely client-side over whatever `items` the caller
 * already fetched — this is a deliberate choice, not a shortcut: it
 * preserves the *exact* existing data-fetching behavior of whatever page
 * adopts it (e.g. New Shipment's `listCustomers()` called once on mount,
 * same tenant-scoped /customers endpoint, same response) rather than
 * introducing a new debounced server-search round trip with its own
 * loading states and its own chance to diverge from tenant isolation.
 * Typing therefore filters instantly with no network latency, and this
 * component has no fetch/auth/tenant logic of its own to get wrong.
 *
 * Implements the WAI-ARIA 1.2 combobox (list autocomplete) pattern: the
 * text input carries role="combobox"/aria-expanded/aria-activedescendant,
 * the popup is role="listbox", each row role="option" — full keyboard
 * support (ArrowUp/ArrowDown to move, Enter to select the highlighted
 * row, Escape to close and revert unsaved typing).
 */
export function SearchableSelect<T>({
  id,
  label,
  required,
  hideLabel,
  disabled,
  placeholder = 'Search…',
  items,
  value,
  onChange,
  getOptionId,
  getOptionLabel,
  getOptionSearchText,
  renderOption,
  emptyMessage = 'No matches',
  maxResults = 50,
  className = '',
}: SearchableSelectProps<T>) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

  const listboxId = `${id}-listbox`;
  const optionDomId = (index: number) => `${id}-option-${index}`;

  const selectedItem = useMemo(() => items.find((item) => getOptionId(item) === value), [items, value, getOptionId]);

  // Keep the displayed text in sync with the controlled `value` whenever
  // it changes from outside this component (initial load, a reset after
  // submit, ...) — but only while the list is closed, so an externally
  // driven update never clobbers text the user is actively typing.
  useEffect(() => {
    if (isOpen) return;
    setQuery(selectedItem ? getOptionLabel(selectedItem) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getOptionLabel/getOptionId are expected to be stable per caller render, matching value/items as the real dependencies
  }, [isOpen, selectedItem]);

  const { matches: filtered, truncatedCount } = useMemo(
    () => filterSearchableOptions(items, query, getOptionSearchText ?? getOptionLabel, maxResults),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getOptionSearchText/getOptionLabel are expected to be stable per caller render; items/query/maxResults are the real reactive inputs
    [items, query, maxResults],
  );
  const activeIndex = filtered.length === 0 ? -1 : Math.min(highlightedIndex, filtered.length - 1);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, isOpen]);

  useEffect(() => {
    if (activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Close on any click outside the field+popup. Deliberately not an
  // onBlur handler — a plain blur races with clicking an option (the
  // option's own onMouseDown below handles that half of the problem),
  // and this covers the "clicked elsewhere on the page" half.
  useEffect(() => {
    if (!isOpen) return;
    function handleDocumentMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [isOpen]);

  // Opening via focus/click/arrow-key (as opposed to opening as a side
  // effect of typing — see the input's onChange below) always browses the
  // *full* list, exactly like clicking a native <select> does. Without
  // this, re-opening a field that already has a selection would filter
  // against that selection's own full label (customer number, name, the
  // "—" separator, ...) as if it were a typed query — which usually
  // matches only itself, or nothing at all once the label contains
  // characters (like the em dash) that never appear in the searchable
  // text. Clearing the query on open is what actually satisfies "clicking
  // the field should still show available customers" for an
  // already-selected field, not just an empty one. If the user closes
  // without picking anything new, the sync effect above restores the
  // previously selected label.
  function openListShowingAll() {
    if (disabled) return;
    if (!isOpen) setQuery('');
    setIsOpen(true);
  }

  function selectItem(item: T) {
    onChange(getOptionId(item), item);
    setQuery(getOptionLabel(item));
    setIsOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        openListShowingAll();
        return;
      }
      setHighlightedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        openListShowingAll();
        return;
      }
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      if (!isOpen || filtered.length === 0) return;
      event.preventDefault();
      const item = filtered[activeIndex];
      if (item) selectItem(item);
    } else if (event.key === 'Escape') {
      if (!isOpen) return;
      event.preventDefault();
      setIsOpen(false);
      setQuery(selectedItem ? getOptionLabel(selectedItem) : '');
    } else if (event.key === 'Tab') {
      setIsOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <FieldLabel htmlFor={id} required={required} hideLabel={hideLabel}>
        {label}
      </FieldLabel>
      <input
        ref={inputRef}
        id={id}
        name={id}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={isOpen && activeIndex >= 0 ? optionDomId(activeIndex) : undefined}
        autoComplete="off"
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        className={`${fieldClasses} ${className}`}
        value={query}
        onFocus={openListShowingAll}
        onClick={openListShowingAll}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          if (value) onChange('', undefined);
        }}
        onKeyDown={handleKeyDown}
      />
      {isOpen &&
        (filtered.length === 0 ? (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-500 shadow-lg">
            {emptyMessage}
          </div>
        ) : (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
          >
            {filtered.map((item, index) => {
              const optionId = getOptionId(item);
              const highlighted = index === activeIndex;
              const selected = optionId === value;
              return (
                <li
                  key={optionId}
                  id={optionDomId(index)}
                  role="option"
                  aria-selected={selected}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  onMouseDown={(event) => {
                    // Keep focus on the input (don't let a mousedown on a
                    // non-focusable <li> blur it) so selecting an option
                    // with the mouse behaves identically to selecting it
                    // with the keyboard.
                    event.preventDefault();
                    selectItem(item);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`cursor-pointer px-3.5 py-2 ${
                    highlighted ? 'bg-primary-50 text-primary-700' : 'text-slate-700'
                  } ${selected ? 'font-medium' : ''}`}
                >
                  {renderOption ? renderOption(item, { highlighted, selected }) : getOptionLabel(item)}
                </li>
              );
            })}
            {truncatedCount > 0 && (
              <li role="presentation" className="px-3.5 py-1.5 text-xs text-slate-400">
                +{truncatedCount} more — keep typing to narrow results
              </li>
            )}
          </ul>
        ))}
    </div>
  );
}
