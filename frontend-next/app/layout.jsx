import './globals.css';
import { Providers } from './providers.jsx';

export const metadata = {
  title: 'TimeOptic — ระบบจัดการร้านแว่นตา',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>👓</text></svg>",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
