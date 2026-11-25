import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withBundleAnalyzer({
  reactStrictMode: false,
  serverExternalPackages: ['@react-pdf/renderer', 'unpdf'],
  outputFileTracingIncludes: {
    '/resumes/*/pdf': ['./app/resumes/fonts/**/*'],
  },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },

});
