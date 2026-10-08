import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // In production the browser only ever talks to the web app's own address. Requests to /api/... are forwarded to the
  // API project (API_ORIGIN, e.g. https://nst-connect-api.vercel.app), so the login cookie belongs to one site and
  // keeps working after a refresh. In development API_ORIGIN is unset and the app calls the API on port 3000 directly.
  async rewrites() {
    const api = process.env.API_ORIGIN?.replace(/\/$/, "");
    return api ? [{ source: "/api/:path*", destination: `${api}/api/:path*` }] : [];
  },
};

export default nextConfig;
