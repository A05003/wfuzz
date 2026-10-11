import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import Providers from '@/components/Providers';

export const metadata: Metadata = { title: 'Venue ERP', description: 'Wedding & event venue management' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#18203B' };

// Set direction/language before first paint (from the saved choice) so there is no RTL/LTR flash.
const preset = `try{var l=localStorage.getItem('qasr_lang');if(l==='en'||l==='ar'){document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr'}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: preset }} /></head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
