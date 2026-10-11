/** Production: a static export served by the Node API (one deployment, no Next.js server).
 *  Development (`npm run dev`): the dev server proxies /api to the API on :3000. */
const dev = process.env.NODE_ENV !== 'production';
/** @type {import('next').NextConfig} */
const nextConfig = dev
  ? { async rewrites() { return [{ source: '/api/:path*', destination: 'http://127.0.0.1:3000/api/:path*' }]; } }
  : { output: 'export', images: { unoptimized: true } };
export default nextConfig;
