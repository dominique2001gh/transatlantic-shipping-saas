import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Transatlantic Shipping Platform',
    template: '%s · Transatlantic Shipping Platform',
  },
  description:
    'Multi-tenant freight forwarding platform for shipping companies serving Ghana, Nigeria, Sierra Leone, Liberia and beyond.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
