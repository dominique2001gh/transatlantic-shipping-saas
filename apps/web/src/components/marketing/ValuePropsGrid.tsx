import { valueProps } from '@/lib/value-props';

export function ValuePropsGrid() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
      {valueProps.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
              <Icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 font-display text-base font-semibold text-slate-900">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.description}</p>
          </div>
        );
      })}
    </div>
  );
}
