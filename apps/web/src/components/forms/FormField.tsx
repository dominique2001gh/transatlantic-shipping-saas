import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const fieldClasses =
  'mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

function FieldLabel({
  htmlFor,
  children,
  required,
  hideLabel,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className={hideLabel ? 'sr-only' : 'block text-sm font-medium text-slate-700'}>
      {children}
      {required && (
        <span aria-hidden="true" className="text-primary-600">
          {' '}
          *
        </span>
      )}
    </label>
  );
}

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  id: string;
  /** Keeps the label in the accessibility tree (screen readers, form autofill) without reserving visual space — for compact layouts (e.g. an inline table filter) where a visible label would be redundant. Never omit the label itself, only its visible rendering. */
  hideLabel?: boolean;
};

export function TextInput({ label, id, required, hideLabel, className = '', ...props }: TextInputProps) {
  return (
    <div>
      <FieldLabel htmlFor={id} required={required} hideLabel={hideLabel}>
        {label}
      </FieldLabel>
      <input id={id} name={id} required={required} className={`${fieldClasses} ${className}`} {...props} />
    </div>
  );
}

type SelectInputProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string;
  id: string;
  children: ReactNode;
  hideLabel?: boolean;
};

export function SelectInput({ label, id, required, hideLabel, className = '', children, ...props }: SelectInputProps) {
  return (
    <div>
      <FieldLabel htmlFor={id} required={required} hideLabel={hideLabel}>
        {label}
      </FieldLabel>
      <select id={id} name={id} required={required} className={`${fieldClasses} bg-white ${className}`} {...props}>
        {children}
      </select>
    </div>
  );
}

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { label: string; id: string };

export function TextArea({ label, id, required, className = '', ...props }: TextAreaProps) {
  return (
    <div>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <textarea id={id} name={id} required={required} className={`${fieldClasses} ${className}`} {...props} />
    </div>
  );
}
