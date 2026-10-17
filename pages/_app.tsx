import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import localFont from 'next/font/local';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/components/Toast';

const sans = localFont({
  src: '../public/fonts/schibsted-grotesk-latin.woff2',
  weight: '400 900',
  variable: '--font-schibsted',
  display: 'swap',
});
const mono = localFont({
  src: '../public/fonts/jetbrains-mono-latin.woff2',
  weight: '100 800',
  variable: '--font-jetbrains',
  display: 'swap',
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${sans.variable} ${mono.variable} font-sans`}>
      <AuthProvider>
        <ToastProvider>
          <Component {...pageProps} />
        </ToastProvider>
      </AuthProvider>
    </div>
  );
}
