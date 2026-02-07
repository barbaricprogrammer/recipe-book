/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.kroger.com",
      },
      {
        protocol: "https",
        hostname: "www.harristeeter.com",
      },
    ],
  },
};

module.exports = nextConfig;
