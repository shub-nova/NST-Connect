import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // In production the browser only ever talks to the web app's own address. Requests to /api/... are forwarded to the
  // API project (API_ORIGIN, e.g. https://nst-connect-api.vercel.app), so the login cookie belongs to one site and
  // keeps working after a refresh. In development API_ORIGIN is unset and the app calls the API on port 3000 directly.
  // Pages should never be shown inside another site's frame, and browsers should not guess file types. The API
  // sends its own headers (helmet), so /api is left out here.
  async headers() {
    return [
      {
        source: "/((?!api/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  async rewrites() {
    const api = process.env.API_ORIGIN?.replace(/\/$/, "");
    return api ? [{ source: "/api/:path*", destination: `${api}/api/:path*` }] : [];
  },
};

export default nextConfig;
