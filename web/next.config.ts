import type { NextConfig } from 'next';
import path from 'path';

const repoRoot = path.join(__dirname, '../../');
const emptyModulePath = './config/empty-browser-module.js';

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
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
  redirects: () => {
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
        source: '/challenges/inferno/:id',
        destination: '/challenges/inferno/:id/overview',
        permanent: true,
      },
      {
        source: '/challenges/inferno/:id/waves',
        destination: '/challenges/inferno/:id/overview',
        permanent: true,
      },
      {
        source: '/challenges/inferno/:id/waves/:number([^0-9]+)',
        destination: '/challenges/inferno/:id/overview',
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
      {
        source: '/search',
        destination: '/search/challenges',
        permanent: true,
      },
    ];
  },
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    resolveAlias: {
      fs: {
        browser: emptyModulePath,
      },
      'fs/promises': {
        browser: emptyModulePath,
      },
    },
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
};

export default nextConfig;
