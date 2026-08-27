import type { ProcessStep } from '@/lib/process-data';

export function ProcessTimeline({ steps }: { steps: ProcessStep[] }) {
  return (
    <ol className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <li
            key={step.title}
            className="relative flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-card"
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <Icon className="h-5 w-5" />
              </span>
              <span className="font-display text-sm font-semibold text-slate-300">
                {String(index + 1).padStart(2, '0')}
              </span>
            </div>
            <h3 className="mt-4 font-display text-base font-semibold text-slate-900">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.description}</p>
          </li>
        );
      })}
    </ol>
  );
}
