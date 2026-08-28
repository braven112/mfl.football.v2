import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// Define league-specific bundles
const leagueConfigs = [
  {
    name: 'theleague',
    entry: path.join(projectRoot, 'src/scripts/main.js'),
    output: path.join(projectRoot, 'public/assets/js/dist/theleague-tools.js')
  },
  {
    name: 'afl',
    entry: path.join(projectRoot, 'src/scripts/afl.js'),
    output: path.join(projectRoot, 'public/assets/js/dist/afl-tools.js')
  }
];

async function buildLeagueTools() {
  console.log('[build-league-tools] Building JavaScript bundles...\n');

  for (const config of leagueConfigs) {
    console.log(`[build-league-tools] Building ${config.name}...`);

    try {
      await build({
        configFile: false,
        publicDir: false, // Don't copy public directory
        build: {
          lib: {
            entry: config.entry,
            name: `${config.name}Tools`,
            formats: ['iife'],
            fileName: () => path.basename(config.output)
          },
          outDir: path.dirname(config.output),
          emptyOutDir: false,
          minify: 'terser',
          // These bundles are INJECTED INTO MFL'S OWN PAGES, so the output
          // contract matters more than usual and must not drift with the
          // bundler. Both settings below were implicit under Vite 5 and
          // silently changed under Vite 8:
          //
          //  - `target` was unpinned, so the default baseline moved and
          //    top-level `const` was downlevelled to `var`.
          //  - `strict` was defaulted, and the emitted IIFE lost its
          //    "use strict" prologue. On a third-party page that is a real
          //    semantic change: sloppy mode turns a failed assignment into a
          //    silent no-op and an accidental global into a page-scope leak,
          //    next to scripts we do not control.
          //
          // Pinned explicitly so `pnpm build:tools` is reproducible across
          // bundler upgrades. The "use strict" lands INSIDE the IIFE wrapper,
          // never at page scope.
          target: 'es2020',
          rollupOptions: {
            output: {
              entryFileNames: path.basename(config.output),
              strict: true,
            }
          }
        },
        logLevel: 'warn'
      });

      console.log(`  ✅ ${config.name}: ${path.relative(projectRoot, config.output)}`);
    } catch (error) {
      console.error(`  ❌ ${config.name}: Build failed`);
      console.error(error);
      process.exitCode = 1;
    }
  }

  console.log('\n[build-league-tools] Build complete!');
}

buildLeagueTools().catch((error) => {
  console.error('[build-league-tools] Fatal error:', error);
  process.exitCode = 1;
});
