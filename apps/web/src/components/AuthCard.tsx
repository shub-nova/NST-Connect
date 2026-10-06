import { LogoMark } from "./AppShell";

export default function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="space-y-3 text-center">
          <div className="flex items-center justify-center gap-2.5">
            <LogoMark className="h-9 w-9" />
            <span className="text-lg font-semibold text-ink">NST Connect</span>
          </div>
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
