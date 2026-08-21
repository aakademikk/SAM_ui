import path from 'node:path';
import { fileURLToPath } from 'node:url';
import withSerwist from '@serwist/next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Native addons cannot be bundled by webpack — load them at runtime.
  serverExternalPackages: ['sherpa-onnx-node'],
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
  // Next refuses to serve dot-directories out of `public/`, so
  // public/.well-known/assetlinks.json 404s. The TWA wrapper reads the file
  // from the canonical path to verify it owns this origin, so map the path
  // onto a plain static file — which also means the fingerprint can be edited
  // without a rebuild, since `next start` serves public/ from disk.
  async rewrites() {
    return [
      {
        source: '/.well-known/assetlinks.json',
        destination: '/assetlinks.json',
      },
    ];
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

export default withSerwist({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // Disable in dev — hot-reloading + service worker = pain.
  disable: process.env.NODE_ENV === 'development',
})(nextConfig);
