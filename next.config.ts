import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // Native/stream-heavy server deps stay unbundled (Neon's recommendation for ws; pino/argon2 use native bindings).
  serverExternalPackages: ['ws', '@neondatabase/serverless', 'pino', '@node-rs/argon2', 'sharp'],
  // A stray package-lock.json in the user's home dir otherwise makes Next pick the wrong workspace root.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
