import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/api/',
      },
      {
        userAgent: ['ClaudeBot', 'GPTBot', 'Amazonbot'],
        disallow: ['/api/', '/players/'],
        crawlDelay: 10,
      },
      {
        userAgent: ['AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot'],
        disallow: '/',
      },
    ],
  };
}
