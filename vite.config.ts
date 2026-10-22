import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the build works on GitHub Pages under /<repo>/.
// HTTPS=1 serves over a self-signed cert so phones on the LAN can use the mic.
export default defineConfig({
  base: './',
  plugins: [react(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  worker: { format: 'es' },
})
