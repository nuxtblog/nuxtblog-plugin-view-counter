import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  publicDir: false,
  build: {
    lib: {
      entry: { admin: 'src/admin/index.ts', public: 'src/public/index.ts' },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      external: ['vue'],
      output: {
        paths: {
          vue: '/_shared/vue.mjs',
        },
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
})
