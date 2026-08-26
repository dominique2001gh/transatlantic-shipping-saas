export function PublicFooter() {
  return (
    <footer className="border-t border-slate-200 bg-primary-950 text-primary-100">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-white">
              TA
            </span>
            <span className="text-sm font-semibold text-white">
              Transatlantic Shipping Platform
            </span>
          </div>
          <p className="text-xs text-primary-300">
            &copy; {new Date().getFullYear()} Transatlantic Shipping Platform. All rights
            reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
