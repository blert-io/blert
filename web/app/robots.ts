import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/api/',
      },
      {
        userAgent: 'ClaudeBot',
        disallow: '/api/',
        crawlDelay: 10,
      },
    ],
  };
}
