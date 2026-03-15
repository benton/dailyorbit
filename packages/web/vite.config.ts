import fbteePreset from '@nkzw/babel-preset-fbtee';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import reactCompiler from 'babel-plugin-react-compiler';
import { defineConfig, type Plugin } from 'vite';

/**
 * Cosmograph uses an internal `@/cosmograph/style.module.css` alias that isn't
 * resolved outside their own build tooling and the CSS file isn't shipped in the
 * npm package. This plugin intercepts the import and returns an empty CSS module.
 */
function cosmographCssShim(): Plugin {
  const VIRTUAL_ID = '\0cosmograph-style-shim.module.css';
  return {
    name: 'cosmograph-css-shim',
    resolveId(id) {
      if (id === '@/cosmograph/style.module.css') return VIRTUAL_ID;
    },
    load(id) {
      if (id === VIRTUAL_ID) return 'export default {}';
    },
  };
}

export default defineConfig({
  plugins: [
    cosmographCssShim(),
    tailwindcss(),
    react({
      babel: {
        plugins: [reactCompiler],
        presets: [fbteePreset],
      },
    }),
  ],
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: 'cosmograph-css-shim',
          setup(build) {
            build.onResolve({ filter: /^@\/cosmograph\/style\.module\.css$/ }, () => ({
              path: 'cosmograph-style-shim',
              namespace: 'cosmograph-css-shim',
            }));
            build.onLoad({ filter: /.*/, namespace: 'cosmograph-css-shim' }, () => ({
              contents: 'export default {}',
              loader: 'js',
            }));
          },
        },
      ],
    },
  },
});
