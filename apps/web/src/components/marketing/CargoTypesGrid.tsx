import { cargoTypes } from '@/lib/cargo-types';

export function CargoTypesGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {cargoTypes.map((cargo) => {
        const Icon = cargo.icon;
        return (
          <div
            key={cargo.label}
            className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center shadow-card transition-colors hover:border-primary-200"
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <Icon className="h-6 w-6" />
            </span>
            <span className="text-sm font-medium text-slate-800">{cargo.label}</span>
          </div>
        );
      })}
    </div>
  );
}
