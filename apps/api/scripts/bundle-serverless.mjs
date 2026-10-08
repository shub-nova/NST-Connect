import { build } from 'esbuild';

/**
 * Vercel's Node runtime refuses to `require()` an ES module, and NestJS 12 is one. The compiled API (dist/)
 * is CommonJS and requires @nestjs/*, so for the serverless function the compiled entry is bundled into ONE
 * CommonJS file: the @nestjs packages are folded in (and converted), everything else stays a normal
 * dependency that Vercel packages with the function.
 *
 * It bundles dist/serverless.js, not the TypeScript, so the decorator metadata Nest needs for injection is
 * already there. Run after `nest build`.
 */
await build({
  entryPoints: ['dist/serverless.js'],
  outfile: 'dist/serverless.bundle.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'only-bundle-nestjs',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          // Nest looks these up lazily and copes when they are absent (this app does not use them).
          if (/^@nestjs\/(microservices|websockets)(\/|$)/.test(args.path)) return { path: args.path, external: true };
          if (args.path.startsWith('@nestjs/') || args.path.startsWith('node:')) return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
