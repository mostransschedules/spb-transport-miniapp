/**
 * Управление темами приложения
 */

const THEME_KEY = 'app-theme'

export const THEMES = {
  SYSTEM: 'system',
  BLACK: 'black',
  WHITE: 'white',
  GLASS: 'glass',
  BLACK_GLASS: 'black-glass'
}

/**
 * Получить сохранённую тему
 */
export const getSavedTheme = () => {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return saved || THEMES.SYSTEM
  } catch (error) {
    return THEMES.SYSTEM
  }
}

/**
 * Сохранить тему
 */
export const saveTheme = (theme) => {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch (error) {
    console.error('Failed to save theme:', error)
  }
}

/**
 * Определить системную тему
 */
export const getSystemTheme = () => {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/**
 * Применить тему к документу
 */
export const applyTheme = (theme) => {
  const root = document.documentElement
  
  // Удаляем все классы тем
  root.classList.remove('theme-black', 'theme-white', 'theme-glass', 'theme-black-glass')
  
  if (theme === THEMES.SYSTEM) {
    const systemTheme = getSystemTheme()
    root.classList.add(systemTheme === 'dark' ? 'theme-black' : 'theme-white')
  } else if (theme === THEMES.BLACK) {
    root.classList.add('theme-black')
  } else if (theme === THEMES.WHITE) {
    root.classList.add('theme-white')
  } else if (theme === THEMES.GLASS) {
    root.classList.add('theme-glass')
  } else if (theme === THEMES.BLACK_GLASS) {
    root.classList.add('theme-black-glass')
  }
}

/**
 * Слушать изменения системной темы
 */
export const watchSystemTheme = (callback) => {
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => callback(e.matches ? 'dark' : 'light')
    
    // Современный API
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler)
      return () => mediaQuery.removeEventListener('change', handler)
    }
    // Старый API
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handler)
      return () => mediaQuery.removeListener(handler)
    }
  }
  return () => {}
}
