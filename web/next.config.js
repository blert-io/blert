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
    }
}

module.exports = nextConfig
