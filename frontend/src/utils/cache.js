// =============================================================================
// CACHE UTILITY - Кэширование через Cache API
// =============================================================================
// Cache API не имеет лимита в 5MB как localStorage.
// localStorage используется только для избранного и настроек.
// =============================================================================

const CACHE_NAME = 'gtfs-data-cache-v1'
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 часа
const MAX_CACHE_ENTRIES = 100

const cacheUrl = (key) => `https://cache.local/${encodeURIComponent(key)}`

/**
 * Сохранить данные в кэш
 */
export const setCache = async (key, data) => {
  try {
    if (!('caches' in window)) return
    const cache = await caches.open(CACHE_NAME)
    const body = JSON.stringify({ data, timestamp: Date.now() })
    const response = new Response(body, {
      headers: { 'Content-Type': 'application/json' }
    })
    await cache.put(cacheUrl(key), response)

    const allKeys = await cache.keys()
    if (allKeys.length > MAX_CACHE_ENTRIES) {
      const toDelete = allKeys.slice(0, allKeys.length - MAX_CACHE_ENTRIES)
      for (const req of toDelete) {
        await cache.delete(req)
      }
    }
  } catch (error) {
    console.error('Cache write error:', error)
  }
}

/**
 * Получить данные из кэша
 */
export const getCache = async (key) => {
  try {
    if (!('caches' in window)) return null
    const cache = await caches.open(CACHE_NAME)
    const response = await cache.match(cacheUrl(key))
    if (!response) return null

    const item = await response.json()
    if (Date.now() - item.timestamp > CACHE_DURATION) {
      await cache.delete(cacheUrl(key))
      return null
    }
    return item.data
  } catch (error) {
    return null
  }
}

/**
 * Очистить весь кэш
 */
export const clearCache = async () => {
  try {
    if ('caches' in window) {
      await caches.delete(CACHE_NAME)
    }
  } catch (error) {
    console.error('Cache clear error:', error)
  }
}

/**
 * Получить размер кэша
 */
export const getCacheSize = async () => {
  try {
    if (!('caches' in window)) return '0'
    const cache = await caches.open(CACHE_NAME)
    const keys = await cache.keys()
    return `~${keys.length} entries`
  } catch {
    return '0'
  }
}

/**
 * Проверить актуальность кэша
 */
export const isCacheFresh = async (key) => {
  try {
    if (!('caches' in window)) return false
    const cache = await caches.open(CACHE_NAME)
    const response = await cache.match(cacheUrl(key))
    if (!response) return false
    const item = await response.json()
    return (Date.now() - item.timestamp) < (60 * 60 * 1000)
  } catch {
    return false
  }
}

// При загрузке — очищаем legacy кэш из localStorage
try {
  Object.keys(localStorage)
    .filter(k => k.startsWith('gtfs_cache_'))
    .forEach(k => localStorage.removeItem(k))
} catch { /* ignore */ }
