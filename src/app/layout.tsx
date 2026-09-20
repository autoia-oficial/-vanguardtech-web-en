import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vanguard CRM - Sales Automation',
  description: 'Autonomous sales system for Vanguard Tech',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          :root {
            color-scheme: dark;
          }
        `}</style>
      </head>
      <body className="bg-graphite text-white antialiased">
        <div className="min-h-screen flex flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
