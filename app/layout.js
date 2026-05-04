import "./globals.css";

export const metadata = {
  title: "Ethara Team Task Manager",
  description: "Role-based team task manager built with Next.js",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
