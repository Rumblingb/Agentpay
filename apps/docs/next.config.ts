import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
