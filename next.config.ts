import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isProd ? "/BeanCount" : "",
  images: { unoptimized: true },
  turbopack: {},
};

export default nextConfig;
