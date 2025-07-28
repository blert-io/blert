/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'oldschool.runescape.wiki',
        pathname: '/images/**',
      },
      {
        protocol: 'https',
        hostname: 'chisel.weirdgloop.org',
        pathname: '/static/img/osrs-sprite/**',
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
      {
        source: '/challenges/mokhaiotl/:id',
        destination: '/challenges/mokhaiotl/:id/overview',
        permanent: true,
      },
      {
        source: '/challenges/mokhaiotl/:id/delves',
        destination: '/challenges/mokhaiotl/:id/overview',
        permanent: true,
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { fs: false };
    }

    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg'),
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: { not: [...fileLoaderRule.resourceQuery.not, /url/] }, // exclude if *.svg?url
        use: ['@svgr/webpack'],
      },
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    return config;
  },
};

module.exports = nextConfig;
