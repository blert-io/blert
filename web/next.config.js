/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'oldschool.runescape.wiki',
        pathname: '/images/**',
      },
    ],
  },
  redirects: async () => {
    return [
      {
        source: '/challenges/colosseum/:id',
        destination: '/challenges/colosseum/:id/overview',
        permanent: true,
      },
      {
        source: '/challenges/colosseum/:id/waves',
        destination: '/challenges/colosseum/:id/overview',
        permanent: true,
      },
      {
        source: '/challenges/colosseum/:id/waves/:number([^0-9]+)',
        destination: '/challenges/colosseum/:id/overview',
        permanent: true,
      },
      {
        source: '/raids/tob/:id',
        destination: '/raids/tob/:id/overview',
        permanent: true,
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { fs: false };
    }
    return config;
  },
};

module.exports = nextConfig;
