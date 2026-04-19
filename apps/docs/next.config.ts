import type { NextConfig } from 'next';
import path from 'path';

const monorepoRoot = path.join(__dirname, '..', '..');

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  async redirects() {
    return [
      // Legacy URL — /agentpassport used in early docs and external links
      {
        source:      '/agentpassport',
        destination: '/passport',
        permanent:   true,
      },
    ];
  },
};

export default nextConfig;
