/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // three.js + r3f ship large ESM graphs; keep the dev graph lean.
    optimizePackageImports: ['lucide-react', '@react-three/drei'],
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'X-SAM-Runtime', value: 'core-dashboard' },
        ],
      },
    ];
  },
};

export default nextConfig;
