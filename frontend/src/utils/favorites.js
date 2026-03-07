// =============================================================================
// FAVORITES - Работа с избранными маршрутами
// =============================================================================

const FAVORITES_KEY = 'gtfs_favorites'

/**
 * Получить список избранных маршрутов
 * @returns {Array} Массив объектов
 */
export const getFavorites = () => {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY)
    const favorites = stored ? JSON.parse(stored) : []
    
    // Миграция старых записей без поля type
    const migrated = favorites.map(f => {
      if (!f.type) {
        return { ...f, type: f.stopName ? 'stop' : 'route' }
      }
      return f
    })
    
    // Сохраняем если были изменения
    const hadChanges = favorites.some(f => !f.type)
    if (hadChanges) {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(migrated))
    }
    
    return migrated
  } catch (error) {
    console.error('Error reading favorites:', error)
    return []
  }
}

/**
 * Добавить маршрут в избранное
 * @param {Object} favorite - {routeName, routeLongName, stopName?, direction?, dayType?, type}
 */
export const addFavorite = (favorite) => {
  try {
    const favorites = getFavorites()
    
    // ID зависит от типа избранного
    let id
    if (favorite.type === 'route') {
      id = `route_${favorite.routeName}_${favorite.routeId || ''}`
    } else {
      id = `${favorite.routeName}_${favorite.stopName}_${favorite.direction}_${favorite.dayType}`
    }
    
    // Проверяем что такого нет уже — по id ИЛИ по совпадению routeName+routeId для маршрутов
    let exists = favorites.some(f => f.id === id)
    
    // Также проверяем старый формат без routeId
    if (!exists && favorite.type === 'route') {
      exists = favorites.some(f => 
        f.type === 'route' && 
        f.routeName === favorite.routeName && 
        String(f.routeId || '') === String(favorite.routeId || '')
      )
    }
    
    if (exists) {
      return false
    }
    
    // Удаляем старые записи того же маршрута с другим форматом ID
    const cleaned = favorites.filter(f => {
      if (f.type !== 'route') return true
      if (f.routeName !== favorite.routeName) return true
      if (String(f.routeId || '') !== String(favorite.routeId || '')) return true
      return false
    })
    
    // Добавляем с timestamp
    cleaned.unshift({
      ...favorite,
      timestamp: Date.now(),
      id: id
    })
    
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(cleaned))
    return true
  } catch (error) {
    console.error('Error adding favorite:', error)
    return false
  }
}

/**
 * Удалить из избранного
 * @param {string} id - ID избранного
 */
export const removeFavorite = (id) => {
  try {
    const favorites = getFavorites()
    const filtered = favorites.filter(f => f.id !== id)
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(filtered))
    return true
  } catch (error) {
    console.error('Error removing favorite:', error)
    return false
  }
}

/**
 * Проверить находится ли маршрут в избранном
 * @param {string} routeName 
 * @param {string} stopName 
 * @param {number} direction 
 * @param {string} dayType 
 * @returns {boolean}
 */
export const isFavorite = (routeName, stopName, direction, dayType) => {
  const favorites = getFavorites()
  return favorites.some(f => 
    f.routeName === routeName &&
    f.stopName === stopName &&
    f.direction === direction &&
    f.dayType === dayType
  )
}

/**
 * Очистить все избранные
 */
export const clearFavorites = () => {
  try {
    localStorage.removeItem(FAVORITES_KEY)
    return true
  } catch (error) {
    console.error('Error clearing favorites:', error)
    return false
  }
}
