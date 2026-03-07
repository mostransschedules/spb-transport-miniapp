// =============================================================================
// VITE CONFIGURATION
// =============================================================================
// Vite - это современный сборщик для frontend проектов
// Он компилирует React код в оптимизированный JavaScript/CSS
// =============================================================================

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  
  // Настройки сервера для разработки
  server: {
    port: 3000,
    host: true,  // Позволяет подключаться с других устройств в локальной сети
    open: true   // Автоматически открывает браузер
  },
  
  // Настройки сборки для продакшена
  build: {
    outDir: 'dist',
    sourcemap: false,  // Не создаём sourcemaps для меньшего размера
    rollupOptions: {
      output: {
        manualChunks: {
          // Разделяем vendor библиотеки в отдельный файл для лучшего кэширования
          vendor: ['react', 'react-dom']
        }
      }
    }
  },
  
  // Base URL (для Vercel это будет корень)
  base: '/'
})
