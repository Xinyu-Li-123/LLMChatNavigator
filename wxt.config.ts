import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  manifest: {
    name: 'LLM Chat Navigator',
    description: 'A floating ChatGPT navigation UI.',
    permissions: ['storage'],
    host_permissions: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  },

  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  }),
});
