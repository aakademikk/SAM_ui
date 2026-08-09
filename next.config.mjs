import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // three.js + r3f ship large ESM graphs; keep the dev graph lean.
    optimizePackageImports: ['lucide-react', '@react-three/drei'],
  },
  // simli-client v3.0.2 has a case-sensitivity bug on Linux:
  // dist/index.js imports ./Client (uppercase) but the file is dist/client.js
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'simli-client/dist/Client': path.resolve(
        __dirname,
        'node_modules/simli-client/dist/client.js',
      ),
    };
    return config;
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
