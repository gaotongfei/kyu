import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withBundleAnalyzer({
  reactStrictMode: false,
  logging: false,
  serverExternalPackages: ['@react-pdf/renderer', 'unpdf'],
  transpilePackages: ['marked'],
  outputFileTracingIncludes: {
    '/resumes/*/pdf': ['./app/resumes/fonts/**/*'],
  },
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
});
