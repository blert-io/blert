/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'oldschool.runescape.wiki',
                pathname: '/images/**',
            }
        ]
    },
    redirects: async () => {
        return [
            {
                source: '/raids/tob/:id',
                destination: '/raids/tob/:id/overview',
                permanent: true,
            },
        ]
    }
}

module.exports = nextConfig
