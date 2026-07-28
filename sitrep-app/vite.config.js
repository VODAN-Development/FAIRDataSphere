import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite builds the React single-page app and enables React Fast Refresh in dev.
export default defineConfig({
  plugins: [react()],
})
