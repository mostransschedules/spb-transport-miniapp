// =============================================================================
// APP.JSX - Главный компонент приложения
// =============================================================================
// Управляет всем состоянием приложения и навигацией
// =============================================================================

import { useState, useEffect, useRef, useMemo } from 'react'
import { getRoutes, getStops, getSchedule, searchStops, getNearbyStops, getTransfers } from './utils/api'
import { getFavorites, addFavorite, removeFavorite, isFavorite } from './utils/favorites'
import { getSavedTheme, saveTheme, applyTheme, watchSystemTheme, THEMES } from './utils/theme'
import { getHistory, addRouteToHistory, addStopToHistory, clearHistory, formatHistoryTime } from './utils/history'
import StatsTabs from './components/StatsTabs'
import ThemeSelector from './components/ThemeSelector'
import LiveMap from './components/LiveMap'
import ForecastBlock from './components/ForecastBlock'
import FavForecast from './components/FavForecast'
import FavForecastLabeled from './components/FavForecastLabeled'
import './App.css'
import './themes.css'
import './animations.css'

// СПб: электробусов нет, тип транспорта определяется по полю transport_type ('bus', 'trolley', 'tram')

// Skeleton компоненты вне App — не пересоздаются при каждом ре-рендере
const SkeletonRouteGrid = () => (
  <div className="route-grid">
    {Array(12).fill(0).map((_, i) => (
      <div key={i} className="skeleton-route-card" style={{ animationDelay: `${i * 0.05}s` }}>
        <div className="skeleton skeleton-route-number" />
        <div className="skeleton skeleton-route-name" />
      </div>
    ))}
  </div>
)

const SkeletonRouteList = () => (
  <div className="route-list">
    {Array(8).fill(0).map((_, i) => (
      <div key={i} className="skeleton-route-list-item" style={{ animationDelay: `${i * 0.04}s` }}>
        <div className="skeleton skeleton-list-number" />
        <div className="skeleton skeleton-list-name" />
        <div className="skeleton skeleton-list-star" />
      </div>
    ))}
  </div>
)

const SkeletonStops = () => (
  <div className="route-list">
    {Array(8).fill(0).map((_, i) => (
      <div key={i} className="skeleton-stop-card" style={{ animationDelay: `${i * 0.04}s` }}>
        <div className="skeleton skeleton-stop-number" />
        <div className="skeleton-stop-info">
          <div className="skeleton skeleton-stop-name" />
          <div className="skeleton skeleton-stop-time" />
        </div>
      </div>
    ))}
  </div>
)

const SkeletonSchedule = () => (
  <div className="schedule-by-hour">
    {Array(4).fill(0).map((_, i) => (
      <div key={i} className="skeleton-hour-group" style={{ animationDelay: `${i * 0.06}s` }}>
        <div className="skeleton skeleton-hour-header" />
        <div className="skeleton-chips">
          {Array(6).fill(0).map((_, j) => (
            <div key={j} className="skeleton skeleton-chip" style={{ animationDelay: `${j * 0.03}s` }} />
          ))}
        </div>
      </div>
    ))}
  </div>
)

function App() {
  // =============================================================================
  // STATE (состояние приложения)
  // =============================================================================
  
  // Ловим все необработанные ошибки и показываем на экране (отладка iOS)
  const [crashError, setCrashError] = useState(null)

  const [tg] = useState(() => window.Telegram?.WebApp)
  const [routes, setRoutes] = useState([])
  const [filteredRoutes, setFilteredRoutes] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [stopResults, setStopResults] = useState([])
  const [searchType, setSearchType] = useState('route') // 'route' | 'stop'
  const [isSearchingStops, setIsSearchingStops] = useState(false)
  const [nearbyStops, setNearbyStops] = useState([])
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [nearbyError, setNearbyError] = useState(null)
  const [nearbyExpanded, setNearbyExpanded] = useState(false)
  const [nearbyLoaded, setNearbyLoaded] = useState(false)
  const [nearbyExpandedStops, setNearbyExpandedStops] = useState([])
  // Ближайшие рейсы для каждой остановки: { "stopName|routeId|dir": {time, diffMin} }
  const [nearbyDepartures, setNearbyDepartures] = useState({})

  // Пересадки на остановке
  const [transfers, setTransfers] = useState([])
  const [transfersTick, setTransfersTick] = useState(0)
  const [transfersLoading, setTransfersLoading] = useState(false)
  const [transfersLoaded, setTransfersLoaded] = useState(false)
  const [transfersExpanded, setTransfersExpanded] = useState(true)
  const transfersRawRef = useRef([]) // raw data with all upcoming times for recalculation

  const searchTimeoutRef = useRef(null)

  const [selectedRoute, setSelectedRoute] = useState(null)
  const [stops, setStops] = useState([])
  const [selectedStop, setSelectedStop] = useState(null)
  const [schedule, setSchedule] = useState([])
  const [direction, setDirection] = useState(0)
  const [dayType, setDayType] = useState('weekday')
  const [loading, setLoading] = useState(false)
  const [loadingType, setLoadingType] = useState(null) // 'routes' | 'stops' | 'schedule'
  const [pullRefreshing, setPullRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)

  // Кнопка "наверх"
  const [showScrollTop, setShowScrollTop] = useState(false)

  const [error, setError] = useState(null)
  const [showError, setShowError] = useState(true)
  const [cacheWarning, setCacheWarning] = useState(null)
  const [favorites, setFavorites] = useState([])
  const [showingFavorites, setShowingFavorites] = useState(false)

  const [routeViewMode, setRouteViewMode] = useState(() => {
    // Загружаем из LocalStorage
    const saved = localStorage.getItem('routeViewMode')
    return saved || 'grid'
  })

  const [favNextDepartures, setFavNextDepartures] = useState({})
  const [favSchedules, setFavSchedules] = useState({})
  const favSchedulesRef = useRef({})
  const stopSchedulesRef = useRef({})
  const nearbySchedulesRef = useRef({})

  // Таймер — пересчитываем "через N мин" каждую минуту
  // Темы
  const [currentTheme, setCurrentTheme] = useState(getSavedTheme())
  const [showThemeSelector, setShowThemeSelector] = useState(false)

  // История просмотров
  const [history, setHistory] = useState(() => getHistory())
  const [showHistory, setShowHistory] = useState(false)
  
  // Раскрытые группы избранного
  const [expandedFavGroups, setExpandedFavGroups] = useState([])
  const [expandedFavRoutes, setExpandedFavRoutes] = useState([]) // группы, где показаны все маршруты

  // Активный таб — сохраняем выбор пользователя
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem('activeTab')
    return saved || 'routes'
  })
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef(null)
  const favTapRef = useRef(0)
  const [visibleRoutesCount, setVisibleRoutesCount] = useState(50)
  const [visibleStopsCount, setVisibleStopsCount] = useState(10)
  const [routeTypeFilter, setRouteTypeFilter] = useState('all')
  const [showLiveMap, setShowLiveMap] = useState(false)
  const [liveMapRouteId, setLiveMapRouteId] = useState(null)
  const [liveMapRouteName, setLiveMapRouteName] = useState(null)
  const [liveMapTransportType, setLiveMapTransportType] = useState(null)

  // Обработчик смены темы
  const handleThemeChange = (theme) => {
    setCurrentTheme(theme)
    saveTheme(theme)
    applyTheme(theme)
  }

  // Определяем тип поиска по запросу
  const detectSearchType = (query) => {
    const q = query.trim().toLowerCase()
    if (!q) return 'route'
    const routePattern = /^(\d|б|в|м|е|с|т|з|н|к|э|д)/
    if (routePattern.test(q) && q.length <= 6) return 'route'
    if (q.includes(' ') || q.length > 5) return 'stop'
    return 'route'
  }

  // =============================================================================
  // ЗАГРУЗКА ДАННЫХ
  // =============================================================================
  
  // Загрузить ближайшие рейсы для всех остановок сразу

  const loadStopsForRoute = async () => {
    if (!selectedRoute) return
    
    setLoading(true)
    setLoadingType('stops')
    try {
      const data = await getStops(selectedRoute.route_short_name, direction, selectedRoute.route_id)
      setStops(data)
      setNextDepartures({})
      stopSchedulesRef.current = {}
      loadAllNextDepartures(data, selectedRoute.route_short_name, direction, dayType, selectedRoute.route_id)
    } catch (err) {
      setError('Не удалось загрузить остановки')
    } finally {
      setLoading(false)
      setLoadingType(null)
    }
  }

  // Загрузить расписание для остановки (с текущими direction и dayType)
  const loadScheduleForStop = async (stop, newDirection = direction, newDayType = dayType) => {
    if (!selectedRoute || !stop) return

    setLoading(true)
    setLoadingType('schedule')
    setCacheWarning(null)

    try {
      const result = await getSchedule(
        selectedRoute.route_short_name,
        stop.stop_name,
        newDirection,
        newDayType
      , selectedRoute.route_id)
      setSchedule(result.schedule)

      if (result.fromCache) {
        setCacheWarning(result.error || 'Показаны сохранённые данные')
      }
    } catch (err) {
      setError('Не удалось загрузить расписание')
    } finally {
      setLoading(false)
      setLoadingType(null)
    }
  }

  // Загрузить пересадки на остановке
  // Пересчёт ближайших рейсов пересадок по текущему времени
  const recalcTransfers = (rawData) => {
    if (!rawData || !rawData.length) return rawData
    const now = new Date()
    const nowH = now.getHours()
    const nowM = now.getMinutes()
    const normalizedNow = nowH < 4 ? (nowH + 24) * 60 + nowM : nowH * 60 + nowM
    const isNightTime = nowH >= 23 || nowH < 7

    return rawData
      .filter(tr => {
        if (!isNightTime && /^н\d/i.test(tr.route_short_name)) return false
        return true
      })
      .map(tr => {
        const upcoming = (tr.all_times || tr.next_times || [])
          .map(nt => {
            const [h, m] = nt.time.split(':').map(Number)
            const total = h < 4 ? (h + 24) * 60 + m : h * 60 + m
            return { time: nt.time, diff_min: total - normalizedNow }
          })
          .filter(nt => nt.diff_min >= 0)
        if (upcoming.length === 0) return null
        return { ...tr, next_times: upcoming.slice(0, 3) }
      })
      .filter(Boolean)
      .sort((a, b) => (a.next_times[0]?.diff_min ?? 9999) - (b.next_times[0]?.diff_min ?? 9999))
  }

  // Live-recalculated transfers for display (recalc on every render)
  const displayTransfers = (transfersRawRef.current && transfersRawRef.current.length > 0)
    ? (recalcTransfers(transfersRawRef.current) || [])
    : transfers

  const loadTransfers = async (stopName, routeId, dt) => {
    setTransfersLoading(true)
    setTransfers([])
    setTransfersLoaded(false)
    setTransfersExpanded(true)
    try {
      const data = await getTransfers(stopName, routeId, dt)
      // Store raw data with ALL upcoming times for recalculation
      transfersRawRef.current = data.map(tr => ({ ...tr, all_times: [...tr.next_times] }))
      setTransfers(recalcTransfers(transfersRawRef.current))
    } catch (err) {
      console.error('❌ Ошибка загрузки пересадок:', err)
      setTransfers([])
      transfersRawRef.current = []
    } finally {
      setTransfersLoading(false)
      setTransfersLoaded(true)
    }
  }

  // При смене направления - ищем ту же остановку в новом направлении
  const handleDirectionChange = async (newDirection) => {
    if (!selectedRoute) return

    setLoading(true)
    setCacheWarning(null)

    try {
      // Загружаем остановки нового направления
      const newStops = await getStops(selectedRoute.route_short_name, newDirection, selectedRoute.route_id)
      setStops(newStops)

      if (selectedStop) {
        // Ищем ту же остановку в новом направлении
        const sameStop = newStops.find(s => s.stop_name === selectedStop.stop_name)

        if (sameStop) {
          // Остановка есть в новом направлении - загружаем расписание
          setSelectedStop(sameStop)
          const result = await getSchedule(
            selectedRoute.route_short_name,
            sameStop.stop_name,
            newDirection,
            dayType
          , selectedRoute.route_id)
          setSchedule(result.schedule)
          if (result.fromCache) setCacheWarning(result.error || 'Показаны сохранённые данные')
        } else {
          // Остановки нет в новом направлении - возвращаемся к списку
          setSelectedStop(null)
          setSchedule([])
        }
      }
    } catch (err) {
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }

  const loadRoutes = async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setPullRefreshing(true)
    } else {
      setLoading(true)
      setLoadingType('routes')
    }
    setError(null)
    setShowError(true)
    try {
      const data = await getRoutes()
      setRoutes(data)
      setFilteredRoutes(data)
    } catch (err) {
      setError('Не удалось загрузить маршруты')
    } finally {
      setLoading(false)
      setLoadingType(null)
      setPullRefreshing(false)
      setPullDistance(0)
    }
  }

  // Группировать расписание по часам
  const groupScheduleByHour = (times) => {
    const grouped = {}
    times.forEach(time => {
      const hour = parseInt(time.split(':')[0])
      if (!grouped[hour]) {
        grouped[hour] = []
      }
      grouped[hour].push(time)
    })
    return grouped
  }

  // Загрузить остановки при выборе маршрута
  const handleRouteSelect = async (route) => {
    setSelectedRoute(route)
    setSelectedStop(null)
    setSchedule([])
    setCacheWarning(null)
    setNextDepartures({})
    setTransfers([])
    setTransfersLoaded(false)
    setTransfersExpanded(true)
    transfersRawRef.current = []
    setLoading(true)
    setLoadingType('stops')

    // Записываем в историю
    addRouteToHistory(route)
    setHistory(getHistory())
    
    try {
      const data = await getStops(route.route_short_name, direction, route.route_id)
      setStops(data)
      loadAllNextDepartures(data, route.route_short_name, direction, dayType, route.route_id)
    } catch (err) {
      setError('Не удалось загрузить остановки')
    } finally {
      setLoading(false)
      setLoadingType(null)
    }
  }

  // Прямой переход к расписанию остановки из поиска
  // stop: { stop_name }, route: { route_id, route_short_name }, direction: 0|1
  const navigateToStopSchedule = async (stopName, route, dir, dayTypeOverride) => {
    const foundRoute = routes.find(r => String(r.route_id) === String(route.route_id))
    if (!foundRoute) {
      console.warn('Route not found:', route.route_id, routes.slice(0,3).map(r => r.route_id))
      return
    }

    // Определяем dayType: переданный > авто по дню недели
    const effectiveDayType = dayTypeOverride || ([0, 6].includes(new Date().getDay()) ? 'weekend' : 'weekday')

    setSearchQuery('')
    setStopResults([])
    setSelectedRoute(foundRoute)
    setSelectedStop(null)
    setSchedule([])
    setCacheWarning(null)
    setNextDepartures({})
    setTransfers([])
    setTransfersLoaded(false)
    transfersRawRef.current = []
    setTransfersExpanded(true)
    setDirection(dir)
    setDayType(effectiveDayType)
    setLoading(true)
    setLoadingType('schedule')

    addRouteToHistory(foundRoute)
    setHistory(getHistory())

    try {
      // Загружаем остановки нужного направления
      const stopsData = await getStops(foundRoute.route_short_name, dir, foundRoute.route_id)
      setStops(stopsData)

      // Ищем нужную остановку
      const targetStop = stopsData.find(s => s.stop_name === stopName)
      if (!targetStop) {
        // Остановка не найдена в этом направлении — показываем список
        setLoading(false)
        setLoadingType(null)
        return
      }

      // Сразу открываем расписание
      setSelectedStop(targetStop)
      addStopToHistory(foundRoute, targetStop, dir, effectiveDayType)
      setHistory(getHistory())

      const result = await getSchedule(
        foundRoute.route_short_name,
        targetStop.stop_name,
        dir,
        effectiveDayType,
        foundRoute.route_id
      )
      setSchedule(result.schedule)
      if (result.fromCache) setCacheWarning(result.error || 'Показаны сохранённые данные')

      // Скролл к ближайшему рейсу
      setTimeout(() => {
        const nearest = document.querySelector('.time-chip-small.nearest')
        if (nearest) {
          nearest.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 150)
    } catch (err) {
      setError('Не удалось загрузить расписание')
    } finally {
      setLoading(false)
      setLoadingType(null)
    }
  }

  // Загрузить ближайшие рейсы для всех остановок рядом
  const loadNearbyDepartures = async (stops) => {
    const dayType = [0, 6].includes(new Date().getDay()) ? 'weekend' : 'weekday'

    await Promise.all(stops.flatMap(stop =>
      stop.routes.map(async route => {
        const key = `${stop.stop_name}|${route.route_id}|${route.direction}`
        try {
          const result = await getSchedule(
            route.route_short_name,
            stop.stop_name,
            route.direction,
            dayType,
            route.route_id
          )
          const schedule = result.schedule || []
          // Сохраняем расписание в ref для ежеминутного пересчёта таймером
          nearbySchedulesRef.current[key] = schedule
          const next = getNextDeparture(schedule)
          setNearbyDepartures(prev => ({ ...prev, [key]: next }))
        } catch {
          setNearbyDepartures(prev => ({ ...prev, [key]: null }))
        }
      })
    ))
  }

  // Запросить геолокацию и загрузить ближайшие остановки
  const handleNearbyStops = () => {
    if (!navigator.geolocation) {
      setNearbyError('Геолокация не поддерживается вашим устройством')
      setNearbyLoaded(true)
      return
    }
    setNearbyLoading(true)
    setNearbyError(null)
    setNearbyStops([])
    setNearbyDepartures({})
    nearbySchedulesRef.current = {}

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const stops = await getNearbyStops(pos.coords.latitude, pos.coords.longitude, 500)
          setNearbyStops(stops)
          setNearbyLoading(false)
          setNearbyLoaded(true)
          if (stops.length > 0) {
            loadNearbyDepartures(stops)
          }
        } catch {
          setNearbyError('Не удалось загрузить остановки')
          setNearbyLoading(false)
          setNearbyLoaded(true)
        }
      },
      (err) => {
        const msg = err.code === 1
          ? 'Разрешите доступ к геолокации в настройках'
          : 'Не удалось определить местоположение'
        setNearbyError(msg)
        setNearbyLoading(false)
        setNearbyLoaded(true)
      },
      { timeout: 10000, maximumAge: 30000 }
    )
  }

  // Переключение разворачивания блока "Остановки рядом"
  const handleToggleNearby = () => {
    const newExpanded = !nearbyExpanded
    setNearbyExpanded(newExpanded)
    // Загружаем при первом разворачивании
    if (newExpanded && !nearbyLoaded && !nearbyLoading) {
      handleNearbyStops()
    }
  }

  // Цвет номера маршрута по типу транспорта
  // route_type: 0=трамвай(красный), 3=автобус(зелёный), 4=троллейбус(синий)
  const getRouteTypeClass = (route) => {
    if (!route) return 'route-type-bus'
    const tt = route?.transport_type
    if (tt === 'tram' || route?.route_type === 0) return 'route-type-tram'
    if (tt === 'trolley') return 'route-type-trolley'
    return 'route-type-bus'
  }

  // Определить класс по сохранённым routeType/transportType (для истории и избранного)
  const getTypeClassByMeta = (routeType, transportType) => {
    if (transportType === 'tram') return 'route-type-tram'
    if (transportType === 'trolley') return 'route-type-trolley'
    if (transportType === 'bus') return 'route-type-bus'
    if (routeType === 0) return 'route-type-tram'
    if (routeType === 5 || routeType === 11) return 'route-type-trolley'
    return 'route-type-bus'
  }

  // Категория маршрута для фильтрации
  const getRouteCategory = (route) => {
    const tt = route?.transport_type
    if (tt === 'tram' || route?.route_type === 0) return 'tram'
    if (tt === 'trolley') return 'trolley'
    return 'bus'
  }

  const getRouteDisplayName = (route) => {
    if (!route || !route.route_long_name) return ''
    
    const name = route.route_long_name
    
    // Если есть разделитель " - " и выбрано обратное направление
    if (name.includes(' - ') && direction === 1) {
      const parts = name.split(' - ')
      // Разворачиваем: "A - B" → "B - A"
      return parts.reverse().join(' - ')
    }
    
    return name
  }

  // Загрузить расписание при выборе остановки
  const handleStopSelect = async (stop) => {
    setSelectedStop(stop)
    setLoading(true)
    setLoadingType('schedule')
    setCacheWarning(null)
    setTransfers([])
    setTransfersLoaded(false)

    // Записываем в историю
    addStopToHistory(selectedRoute, stop, direction, dayType)
    setHistory(getHistory())
    
    try {
      const result = await getSchedule(
        selectedRoute.route_short_name,
        stop.stop_name,
        direction,
        dayType
      , selectedRoute.route_id)
      
      setSchedule(result.schedule)
      
      if (result.fromCache) {
        setCacheWarning(result.error || 'Показаны сохранённые данные')
      }
    } catch (err) {
      setError('Не удалось загрузить расписание')
    } finally {
      setLoading(false)
      setLoadingType(null)
    }
  }

  // =============================================================================
  // ИЗБРАННОЕ
  // =============================================================================

  // Вычислить ближайший рейс из расписания относительно текущего времени
  const getNextDeparture = (scheduleData) => {
    if (!scheduleData || scheduleData.length === 0) return null

    const now = new Date()
    // Используем часы И минуты текущего времени
    const nowH = now.getHours()
    const nowM = now.getMinutes()

    // Нормализуем текущее время для транспортных суток (после полуночи до 4:00)
    const normalizedNow = nowH < 4
      ? (nowH + 24) * 60 + nowM
      : nowH * 60 + nowM

    // Парсим только реальные времена из расписания (первые 5 символов "HH:MM")
    const allTimes = scheduleData
      .map(time => {
        const str = String(time).substring(0, 5)
        const parts = str.split(':')
        if (parts.length < 2) return null
        const h = parseInt(parts[0], 10)
        const m = parseInt(parts[1], 10)
        if (isNaN(h) || isNaN(m)) return null
        // Нормализуем для транспортных суток
        const totalMin = h < 4 ? (h + 24) * 60 + m : h * 60 + m
        return { time: str, totalMin }
      })
      .filter(Boolean)

    // Сортируем по нормализованному времени
    allTimes.sort((a, b) => a.totalMin - b.totalMin)

    // Ищем первый рейс СТРОГО после текущего времени
    const next = allTimes.find(t => t.totalMin >= normalizedNow)

    if (!next) return null

    const diffMin = next.totalMin - normalizedNow

    // Отладка: показываем 3 ближайших рейса
    const nearby = allTimes.filter(t => t.totalMin >= normalizedNow).slice(0, 3)
    console.log(`⏰ Текущее время: ${nowH}:${String(nowM).padStart(2,'0')} (${normalizedNow} мин)`)
    console.log(`📋 3 ближайших из расписания:`, nearby.map(t => t.time))
    console.log(`✅ Выбран: ${next.time} (через ${diffMin} мин)`)

    return { time: next.time, diffMin }
  }

  // Кэш ближайших рейсов для остановок {stopName: {time, diffMin}}
  const [nextDepartures, setNextDepartures] = useState({})
  const [stopSchedules, setStopSchedules] = useState({}) // для пересчёта таймером

  const loadAllNextDepartures = async (stopsData, routeName, dir, dt, routeId = null) => {
    if (!routeName || !stopsData?.length) return

    const chunkSize = 5
    for (let i = 0; i < stopsData.length; i += chunkSize) {
      const chunk = stopsData.slice(i, i + chunkSize)
      await Promise.all(chunk.map(async (stop) => {
        try {
          const result = await getSchedule(routeName, stop.stop_name, dir, dt, routeId)
          const next = getNextDeparture(result.schedule)
          setNextDepartures(prev => ({ ...prev, [stop.stop_name]: next }))
          setStopSchedules(prev => ({ ...prev, [stop.stop_name]: result.schedule }))
          stopSchedulesRef.current[stop.stop_name] = result.schedule
        } catch (err) {
          console.error(`❌ Ошибка для ${stop.stop_name}:`, err)
        }
      }))
    }
  }

  // Загрузить ближайший рейс для одной остановки (при добавлении в избранное)
  const loadNextDeparture = async (stop) => {
    if (!selectedRoute || !stop) return
    try {
      const result = await getSchedule(
        selectedRoute.route_short_name,
        stop.stop_name,
        direction,
        dayType,
        selectedRoute.route_id
      )
      const next = getNextDeparture(result.schedule)
      setNextDepartures(prev => ({ ...prev, [stop.stop_name]: next }))
      stopSchedulesRef.current[stop.stop_name] = result.schedule
    } catch (err) {
      console.error(`❌ Ошибка загрузки рейса для ${stop.stop_name}:`, err)
    }
  }

  const handleToggleFavorite = () => {
    if (!selectedRoute || !selectedStop) return

    const favoriteData = {
      routeName: selectedRoute.route_short_name,
      routeLongName: selectedRoute.route_long_name,
      routeId: selectedRoute.route_id,
      stopName: selectedStop.stop_name,
      stopId: selectedStop.stop_id,
      direction: direction,
      dayType: dayType,
      type: 'stop',
      routeType: selectedRoute.route_type,
      transportType: selectedRoute.transport_type || 'bus'
    }

    const isCurrentlyFavorite = isFavorite(
      selectedRoute.route_short_name,
      selectedStop.stop_name,
      direction,
      dayType
    )

    if (isCurrentlyFavorite) {
      const id = `${favoriteData.routeName}_${favoriteData.stopName}_${favoriteData.direction}_${favoriteData.dayType}`
      removeFavorite(id)
    } else {
      addFavorite(favoriteData)
    }

    // Обновляем список избранного
    setFavorites(getFavorites())
  }

  const handleToggleFavoriteRoute = (route, event) => {
    if (event) {
      event.stopPropagation()
      event.preventDefault()
    }

    try {
      const rName = route.route_short_name
      const rId = route.route_id
      const newId = `route_${rName}_${rId || ''}`
      
      const raw = localStorage.getItem('gtfs_favorites') || '[]'
      let favs = JSON.parse(raw)
      
      const existIdx = favs.findIndex(f => 
        f.type === 'route' && f.routeName === rName && String(f.routeId || '') === String(rId || '')
      )
      const existById = favs.findIndex(f => f.id === newId)
      
      if (existIdx >= 0 || existById >= 0) {
        favs = favs.filter((f, i) => i !== existIdx && i !== existById)
      } else {
        favs.unshift({
          routeName: rName,
          routeLongName: route.route_long_name,
          routeId: rId,
          type: 'route',
          routeType: route.route_type,
          transportType: route.transport_type || 'bus',
          timestamp: Date.now(),
          id: newId
        })
      }
      
      localStorage.setItem('gtfs_favorites', JSON.stringify(favs))
      setFavorites(favs)
    } catch (err) {
      console.error('Favorite error:', err)
    }
  }

  const isFavoriteRoute = (routeName, routeId) => {
    return favorites.some(f => f.type === 'route' && f.routeName === routeName && String(f.routeId || '') === String(routeId || ''))
  }

  // Загрузить ближайшие рейсы для избранных остановок
  const loadFavNextDepartures = async (favStops) => {
    if (!favStops?.length) return

    const now = new Date()
    const isWeekend = now.getDay() === 0 || now.getDay() === 6
    const currentDayType = isWeekend ? 'weekend' : 'weekday'

    await Promise.all(favStops.map(async (fav) => {
      // Если уже загружено в ref — пропускаем
      if (favSchedulesRef.current[fav.id]) {
        const next = getNextDeparture(favSchedulesRef.current[fav.id])
        setFavNextDepartures(prev => ({ ...prev, [fav.id]: next }))
        return
      }
      
      try {
        const result = await getSchedule(
          fav.routeName,
          fav.stopName,
          fav.direction,
          currentDayType,
          fav.routeId
        )
        const next = getNextDeparture(result.schedule)
        setFavNextDepartures(prev => ({ ...prev, [fav.id]: next }))
        setFavSchedules(prev => ({ ...prev, [fav.id]: result.schedule }))
        favSchedulesRef.current[fav.id] = result.schedule
      } catch (err) {
        setFavNextDepartures(prev => ({ ...prev, [fav.id]: null }))
      }
    }))
  }


  const handleLoadFavorite = async (fav) => {
    // Находим маршрут
    const route = routes.find(r => r.route_short_name === fav.routeName)
    if (!route) {
      setError('Маршрут не найден')
      return
    }

    setSelectedRoute(route)
    setDirection(fav.direction)
    setDayType(fav.dayType)

    // Загружаем остановки
    setLoading(true)
    try {
      const stopsData = await getStops(route.route_short_name, fav.direction, route.route_id)
      setStops(stopsData)

      // Находим остановку
      const stop = stopsData.find(s => s.stop_name === fav.stopName)
      if (stop) {
        setSelectedStop(stop)

        // Загружаем расписание
        const result = await getSchedule(
          route.route_short_name,
          stop.stop_name,
          fav.direction,
          fav.dayType,
          route.route_id
        )
        setSchedule(result.schedule)
      }
    } catch (err) {
      setError('Не удалось загрузить избранный маршрут')
    } finally {
      setLoading(false)
    }
  }

  // =============================================================================
  // ПОДЕЛИТЬСЯ РАСПИСАНИЕМ
  // =============================================================================

  const [showShareModal, setShowShareModal] = useState(false)

  const getNextDepartures = (count) => {
    if (!schedule.length) return []
    const now = new Date()
    const nowH = now.getHours()
    const nowM = now.getMinutes()
    const normalizedNow = nowH < 4 ? (nowH + 24) * 60 + nowM : nowH * 60 + nowM

    return schedule
      .map(t => {
        const str = String(t).substring(0, 5)
        const [h, m] = str.split(':').map(Number)
        const total = h < 4 ? (h + 24) * 60 + m : h * 60 + m
        return { time: str, total }
      })
      .filter(t => t.total >= normalizedNow)
      .slice(0, count)
      .map(t => t.time)
  }

  const buildShareText = (mode) => {
    const route = selectedRoute?.route_short_name
    const stop = selectedStop?.stop_name
    const dayLabel = dayType === 'weekday' ? 'Будни' : 'Выходные'
    const dirLabel = direction === 0 ? 'Прямое' : 'Обратное'

    if (mode === 'next') {
      const next = getNextDepartures(3)
      if (!next.length) return `🚌 Маршрут ${route}\n📍 ${stop}\n⏰ Ближайших рейсов нет`
      return `🚌 Маршрут ${route}\n📍 ${stop}\n🕐 Ближайшие: ${next.join(', ')}`
    }

    // Полное расписание
    const byHour = {}
    schedule.forEach(t => {
      const str = String(t).substring(0, 5)
      const hour = str.split(':')[0]
      if (!byHour[hour]) byHour[hour] = []
      byHour[hour].push(str)
    })
    const sortedHours = Object.keys(byHour).sort((a, b) => {
      const ka = parseInt(a) < 4 ? parseInt(a) + 24 : parseInt(a)
      const kb = parseInt(b) < 4 ? parseInt(b) + 24 : parseInt(b)
      return ka - kb
    })
    const lines = sortedHours.map(h => `${h}:00 — ${byHour[h].join(', ')}`).join('\n')
    return `🚌 Маршрут ${route} · ${dirLabel} · ${dayLabel}\n📍 ${stop}\n\n${lines}`
  }

  const [shareToast, setShareToast] = useState(null)

  const handleShare = (mode) => {
    const text = buildShareText(mode)
    setShowShareModal(false)

    // Копируем в буфер
    const doCopy = () => {
      navigator.clipboard?.writeText(text).catch(() => {
        // fallback для старых браузеров
        const el = document.createElement('textarea')
        el.value = text
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      })
    }

    if (window.Telegram?.WebApp) {
      doCopy()
      // Открываем выбор чата через share URL
      const encoded = encodeURIComponent(text)
      window.Telegram.WebApp.openTelegramLink(`https://t.me/share/url?url=%20&text=${encoded}`)
    } else {
      // Браузер — просто копируем
      doCopy()
      setShareToast('✅ Скопировано в буфер обмена')
      setTimeout(() => setShareToast(null), 2500)
    }
  }

  // =============================================================================
  // PULL-TO-REFRESH
  // =============================================================================
  
  const pullThreshold = 70
  let touchStartY = 0

  const handleTouchStart = (e) => {
    if (!selectedRoute && !selectedStop && window.scrollY === 0) {
      touchStartY = e.touches[0].clientY
    }
  }

  const handleTouchMove = (e) => {
    if (!touchStartY || selectedRoute || selectedStop) return
    const dist = Math.max(0, Math.min(e.touches[0].clientY - touchStartY, pullThreshold * 1.5))
    if (dist > 0 && window.scrollY === 0) {
      setPullDistance(dist)
    }
  }

  const handleTouchEnd = () => {
    if (pullDistance >= pullThreshold && !pullRefreshing) {
      // Haptic feedback
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium')
      loadRoutes(true)
    } else {
      setPullDistance(0)
    }
    touchStartY = 0
  }

  // Навигация по табам
  const handleTabChange = (tab) => {
    setActiveTab(tab)
    localStorage.setItem('activeTab', tab)
    setVisibleRoutesCount(50)
    if (tab !== 'routes') {
      setSelectedRoute(null)
      setSelectedStop(null)
    }
    // Не загружаем данные автоматически — только по нажатию кнопки
  }

  const handleSearchToggle = () => {
    const next = !searchOpen
    setSearchOpen(next)
    if (next) {
      setTimeout(() => searchInputRef.current?.focus(), 150)
    } else {
      setSearchQuery('')
      setStopResults([])
      setFilteredRoutes(routes)
      setSearchType('route')
    }
  }

  // =============================================================================
  // EFFECTS — все useEffect после объявления всех функций
  // =============================================================================

  // Ловим ошибки и показываем на экране (отладка iOS)
  useEffect(() => {
    const onError = (e) => setCrashError((e.message || String(e)) + '\n' + (e.filename || '') + ':' + (e.lineno || ''))
    const onUnhandled = (e) => setCrashError('Promise: ' + String(e.reason))
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandled)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  }, [])

  // Кнопка "наверх"
  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 300)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Таймер — пересчитываем "через N мин" каждую минуту
  useEffect(() => {
    const recalc = () => {
      try {
        const favUpdated = {}
        Object.entries(favSchedulesRef.current).forEach(([id, schedule]) => {
          favUpdated[id] = getNextDeparture(schedule)
        })
        if (Object.keys(favUpdated).length > 0) setFavNextDepartures(favUpdated)

        const stopUpdated = {}
        Object.entries(stopSchedulesRef.current).forEach(([name, schedule]) => {
          stopUpdated[name] = getNextDeparture(schedule)
        })
        if (Object.keys(stopUpdated).length > 0) setNextDepartures(stopUpdated)

        const nearbyUpdated = {}
        Object.entries(nearbySchedulesRef.current).forEach(([key, schedule]) => {
          nearbyUpdated[key] = getNextDeparture(schedule)
        })
        if (Object.keys(nearbyUpdated).length > 0) setNearbyDepartures(nearbyUpdated)

        // Пересадки — пересчитываем ближайшие рейсы
        if (transfersRawRef.current.length > 0) {
          setTransfers(recalcTransfers(transfersRawRef.current))
          setTransfersTick(t => t + 1)
        }
      } catch (e) {
        console.warn('Timer recalc error:', e)
      }
    }
    const now = new Date()
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds()
    let interval
    const timeout = setTimeout(() => {
      recalc()
      interval = setInterval(recalc, 30000)
    }, msUntilNextMinute)
    return () => { clearTimeout(timeout); clearInterval(interval) }
  }, []) // eslint-disable-line

  // Инициализация Telegram
  useEffect(() => {
    try {
      if (tg) {
        tg.ready()
        tg.expand()
        if (typeof tg.enableClosingConfirmation === 'function') {
          tg.enableClosingConfirmation()
        }
      }
    } catch (e) {
      console.warn('Telegram init error:', e)
    }
  }, [tg])

  // Применение темы
  useEffect(() => {
    try {
      applyTheme(currentTheme)
      if (currentTheme === THEMES.SYSTEM) {
        const cleanup = watchSystemTheme(() => applyTheme(THEMES.SYSTEM))
        return cleanup
      }
    } catch (e) {
      console.warn('Theme error:', e)
    }
  }, [currentTheme])

  // Загрузить список маршрутов при старте
  useEffect(() => {
    loadRoutes()
  }, []) // eslint-disable-line

  // Умный поиск: маршруты + остановки
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) {
      setFilteredRoutes(routes)
      setStopResults([])
      setSearchType('route')
      return
    }
    const isRouteQuery = (() => {
      if (/^\d+[\s-]/.test(q)) return false
      if (/^\d+\w*$/.test(q)) return true
      if (/^[абвд]{1,2}к?$/i.test(q)) return true
      if (/^[а-яё]{1,2}[\d-]\w*$/i.test(q)) return true
      return false
    })()
    const query = q.toLowerCase()
    const filtered = routes.filter(route => {
      const nameMatch = route.route_short_name.toLowerCase().includes(query)
      const longNameMatch = isRouteQuery && (route.route_long_name || '').toLowerCase().includes(query)
      return nameMatch || longNameMatch
    })
    setFilteredRoutes(filtered)
    if (!isRouteQuery && q.length >= 2) {
      setSearchType('stop')
      setIsSearchingStops(true)
      clearTimeout(searchTimeoutRef.current)
      searchTimeoutRef.current = setTimeout(async () => {
        const stops = await searchStops(q)
        setStopResults(stops)
        setVisibleStopsCount(10)
        setIsSearchingStops(false)
      }, 350)
    } else {
      setSearchType('route')
      setStopResults([])
      setIsSearchingStops(false)
    }
  }, [searchQuery, routes]) // eslint-disable-line

  // Загрузить избранное при старте
  useEffect(() => {
    const savedFavorites = getFavorites()
    setFavorites(savedFavorites)
  }, []) // eslint-disable-line

  // Загрузить ближайшие рейсы когда избранное готово или таб переключился
  useEffect(() => {
    if (activeTab === 'favorites' && favorites.length > 0) {
      const stopFavs = favorites.filter(f => f.type === 'stop')
      if (stopFavs.length > 0) {
        loadFavNextDepartures(stopFavs)
      }
    }
  }, [activeTab, favorites.length]) // eslint-disable-line

  // =============================================================================
  // RENDER
  // =============================================================================

  // Показываем ошибку вместо чёрного экрана
  if (crashError) {
    return (
      <div style={{padding:20,fontFamily:'monospace',fontSize:12,color:'#c0392b',background:'#fff',minHeight:'100vh',wordBreak:'break-word',whiteSpace:'pre-wrap'}}>
        {'💥 Crash:\n\n' + crashError}
      </div>
    )
  }

  return (
    <div
      className="app"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="container">

        {/* Pull-to-refresh индикатор */}
        {!selectedRoute && !selectedStop && (
          <div
            className="pull-to-refresh"
            style={{
              height: pullDistance > 0 ? `${pullDistance}px` : pullRefreshing ? '60px' : '0px',
              opacity: Math.min(pullDistance / pullThreshold, 1),
            }}
          >
            <div className={`ptr-icon ${pullRefreshing ? 'ptr-spinning' : ''} ${pullDistance >= pullThreshold ? 'ptr-ready' : ''}`}>
              {pullRefreshing ? '⟳' : pullDistance >= pullThreshold ? '↑' : '↓'}
            </div>
            <span className="ptr-label">
              {pullRefreshing ? 'Обновление...' : pullDistance >= pullThreshold ? 'Отпустите' : 'Потяните вниз'}
            </span>
          </div>
        )}
        {/* Кнопка темы — только на главных табах */}
        {!selectedRoute && !selectedStop && !searchOpen && (
        <div className="theme-button-row">
          <button
            className="theme-button-flat"
            onClick={() => setShowThemeSelector(true)}
          >
            🎨 Тема
          </button>
        </div>
        )}

        {/* Заголовок — показываем только на главных табах без вложенной навигации */}
        {!selectedRoute && !selectedStop && (
          <header className="header">
            <h1>🚌 Расписание транспорта</h1>
            <p className="subtitle">Санкт-Петербург</p>
          </header>
        )}

        {/* Предупреждение о кэше */}
        {cacheWarning && (
          <div className="cache-warning">
            <span>⚠️ {cacheWarning}</span>
            <button className="cache-warning-close" onClick={() => setCacheWarning(null)}>✕</button>
          </div>
        )}

        {/* Ошибка */}
        {error && showError && (
          <div className="error">
            <div className="error-content">
              <span>❌ {error}</span>
              <button 
                className="error-close"
                onClick={() => setShowError(false)}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Выбор типа дня и направления — только на странице остановок (selectedRoute && !selectedStop) */}
        {selectedRoute && !selectedStop && (
        <>
        <div className="day-type-selector mb-3">
          <button
            className={dayType === 'weekday' ? 'active' : ''}
            onClick={() => {
              setDayType('weekday')
              if (stops.length > 0) {
                setNextDepartures({})
                loadAllNextDepartures(stops, selectedRoute.route_short_name, direction, 'weekday', selectedRoute.route_id)
              }
            }}
          >
            Будни
          </button>
          <button
            className={dayType === 'weekend' ? 'active' : ''}
            onClick={() => {
              setDayType('weekend')
              if (stops.length > 0) {
                setNextDepartures({})
                loadAllNextDepartures(stops, selectedRoute.route_short_name, direction, 'weekend', selectedRoute.route_id)
              }
            }}
          >
            Выходные
          </button>
        </div>

        <div className="direction-selector mb-3">
          <button
            className={direction === 0 ? 'active' : ''}
            onClick={() => { setDirection(0); handleDirectionChange(0) }}
          >
            → Прямое
          </button>
          <button
            className={direction === 1 ? 'active' : ''}
            onClick={() => { setDirection(1); handleDirectionChange(1) }}
          >
            ← Обратное
          </button>
        </div>
        </>
        )}

        {/* ============================================================
            ТАБ: МАРШРУТЫ
            ============================================================ */}
        {activeTab === 'routes' && !selectedRoute && !searchOpen && (
          <div className="routes-list tab-screen">

            <h2>Выберите маршрут</h2>
            
            {/* Фильтр по типу транспорта */}
            <div className="route-type-filters">
              <button
                className={`route-type-filter-btn ${routeTypeFilter === 'all' ? 'active' : ''}`}
                onClick={() => { setRouteTypeFilter('all'); setVisibleRoutesCount(50) }}
              >
                Все
              </button>
              <button
                className={`route-type-filter-btn filter-bus ${routeTypeFilter === 'bus' ? 'active' : ''}`}
                onClick={() => { setRouteTypeFilter(routeTypeFilter === 'bus' ? 'all' : 'bus'); setVisibleRoutesCount(50) }}
              >
                🟢 Автобус
              </button>
              <button
                className={`route-type-filter-btn filter-tram ${routeTypeFilter === 'tram' ? 'active' : ''}`}
                onClick={() => { setRouteTypeFilter(routeTypeFilter === 'tram' ? 'all' : 'tram'); setVisibleRoutesCount(50) }}
              >
                🔴 Трамвай
              </button>
              <button
                className={`route-type-filter-btn filter-trolley ${routeTypeFilter === 'trolley' ? 'active' : ''}`}
                onClick={() => { setRouteTypeFilter(routeTypeFilter === 'trolley' ? 'all' : 'trolley'); setVisibleRoutesCount(50) }}
              >
                🔵 Троллейбус
              </button>
            </div>
            
            {(() => {
              const typeFiltered = routeTypeFilter === 'all'
                ? filteredRoutes
                : filteredRoutes.filter(r => getRouteCategory(r) === routeTypeFilter)
              
              return loading && loadingType === 'routes' ? (
              routeViewMode === 'grid' ? <SkeletonRouteGrid /> : <SkeletonRouteList />
            ) : typeFiltered.length > 0 ? (
              <>
                {/* Переключатель вида */}
                <div className="view-toggle">
                  <button
                    className={`view-toggle-btn ${routeViewMode === 'grid' ? 'active' : ''}`}
                    onClick={() => {
                      setRouteViewMode('grid')
                      localStorage.setItem('routeViewMode', 'grid')
                    }}
                    title="Сетка"
                  >
                    ⊞
                  </button>
                  <button
                    className={`view-toggle-btn ${routeViewMode === 'list' ? 'active' : ''}`}
                    onClick={() => {
                      setRouteViewMode('list')
                      localStorage.setItem('routeViewMode', 'list')
                    }}
                    title="Список"
                  >
                    ☰
                  </button>
                </div>

                <div className={routeViewMode === 'grid' ? 'route-grid' : 'route-list'}>
                  {typeFiltered.slice(0, visibleRoutesCount).map(route => {
                    const isFav = isFavoriteRoute(route.route_short_name, route.route_id)
                    return (
                    <div
                      key={route.route_id}
                      className={routeViewMode === 'grid' ? 'route-card' : 'route-card-list'}
                      onClick={(e) => {
                        if (e.target.closest('[data-fav-btn]')) return
                        handleRouteSelect(route)
                      }}
                    >
                      {routeViewMode === 'grid' ? (
                        <>
                          <a
                            href="#"
                            data-fav-btn="1"
                            className={`route-favorite-btn-grid ${isFav ? 'active' : ''}`}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleToggleFavoriteRoute(route, e) }}
                          >
                            {isFav ? <span className="fav-star active">★</span> : <span className="fav-star">☆</span>}
                          </a>
                          <div className={`route-number ${getRouteTypeClass(route)}`}>{route.route_short_name}</div>
                          <div className="route-name">{getRouteDisplayName(route)}</div>
                        </>
                      ) : (
                        <>
                          <div className="route-list-content">
                            <span className={`route-number-list ${getRouteTypeClass(route)}`}>{route.route_short_name}</span>
                            <span className="route-name-list">{getRouteDisplayName(route)}</span>
                          </div>
                          <a
                            href="#"
                            data-fav-btn="1"
                            className={`route-favorite-btn ${isFav ? 'active' : ''}`}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleToggleFavoriteRoute(route, e) }}
                          >
                            {isFav ? <span className="fav-star active">★</span> : <span className="fav-star">☆</span>}
                          </a>
                        </>
                      )}
                    </div>
                    )
                  })}
                </div>
                {typeFiltered.length > visibleRoutesCount && (
                  <button
                    className="tab-load-btn"
                    style={{ display: 'block', margin: '16px auto' }}
                    onClick={() => setVisibleRoutesCount(prev => prev + 50)}
                  >
                    Показать ещё ({typeFiltered.length - visibleRoutesCount})
                  </button>
                )}
                <p className="search-results-text mt-2" style={{ textAlign: 'center' }}>
                  {typeFiltered.length} маршрутов
                </p>
              </>
            ) : (
              <div className="info mt-3">
                ℹ️ Нет маршрутов
              </div>
            )
            })()}
          </div>
        )}

        {/* ============================================================
            ГЛОБАЛЬНЫЙ ПОИСК — результаты поверх любого таба
            ============================================================ */}
        {searchOpen && !selectedRoute && !selectedStop && (
          <div className="global-search-results tab-screen">
            {/* Маршруты */}
            {searchQuery && filteredRoutes.length > 0 && (
              <>
                <div className="stop-search-header">🚌 Маршруты</div>
                <div className="route-list">
                  {filteredRoutes.slice(0, 20).map(route => (
                    <div
                      key={route.route_id}
                      className="route-card-list"
                      onClick={() => { setSearchOpen(false); setSearchQuery(''); handleRouteSelect(route) }}
                    >
                      <div className="route-list-content">
                        <span className={`route-number-list ${getRouteTypeClass(route)}`}>{route.route_short_name}</span>
                        <span className="route-name-list">{getRouteDisplayName(route)}</span>
                      </div>
                    </div>
                  ))}
                  {filteredRoutes.length > 20 && (
                    <div className="tab-status">Показано 20 из {filteredRoutes.length}</div>
                  )}
                </div>
              </>
            )}

            {/* Остановки */}
            {stopResults.length > 0 && searchQuery && (
              <div className="stop-search-results">
                <div className="stop-search-header">📍 Остановки ({stopResults.length})</div>
                {stopResults.slice(0, visibleStopsCount).map(stop => (
                  <div key={stop.stop_name} className="stop-search-item">
                    <div className="stop-search-name">{stop.stop_name}</div>
                    <div className="stop-search-routes">
                      {(() => {
                        const routeMap = new Map()
                        stop.routes.forEach(r => {
                          if (!routeMap.has(r.route_id)) {
                            routeMap.set(r.route_id, { ...r, directions: [] })
                          }
                          routeMap.get(r.route_id).directions.push(r.direction)
                        })
                        return [...routeMap.values()].slice(0, 8).map(route => {
                          const typeClass = getRouteTypeClass(route)
                          const dirs = route.directions.filter((v, i, a) => a.indexOf(v) === i)
                          if (dirs.length > 1) {
                            return (
                              <span key={route.route_id} className="stop-search-route-group">
                                <button
                                  className={`stop-search-route-chip ${typeClass}`}
                                  onClick={() => { setSearchOpen(false); setSearchQuery(''); navigateToStopSchedule(stop.stop_name, route, 0) }}
                                >
                                  {route.route_short_name}<span className="chip-arrow">→</span>
                                </button>
                                <button
                                  className={`stop-search-route-chip ${typeClass}`}
                                  onClick={() => { setSearchOpen(false); setSearchQuery(''); navigateToStopSchedule(stop.stop_name, route, 1) }}
                                >
                                  {route.route_short_name}<span className="chip-arrow">←</span>
                                </button>
                              </span>
                            )
                          }
                          return (
                            <button
                              key={route.route_id}
                              className={`stop-search-route-chip ${typeClass}`}
                              onClick={() => { setSearchOpen(false); setSearchQuery(''); navigateToStopSchedule(stop.stop_name, route, dirs[0]) }}
                            >
                              {route.route_short_name}
                            </button>
                          )
                        })
                      })()}
                    </div>
                  </div>
                ))}
                {stopResults.length > visibleStopsCount && (
                  <button
                    className="tab-load-btn"
                    style={{ display: 'block', margin: '12px auto', width: '100%' }}
                    onClick={() => setVisibleStopsCount(prev => prev + 10)}
                  >
                    Показать ещё ({stopResults.length - visibleStopsCount} остановок)
                  </button>
                )}
              </div>
            )}

            {/* Статус поиска */}
            {searchQuery && isSearchingStops && filteredRoutes.length === 0 && (
              <div className="info mt-3">🔍 Ищем остановки...</div>
            )}
            {searchQuery && !isSearchingStops && filteredRoutes.length === 0 && stopResults.length === 0 && (
              <div className="info mt-3">ℹ️ По запросу "{searchQuery}" ничего не найдено</div>
            )}
            {!searchQuery && (
              <div className="tab-empty">
                <div className="tab-empty-icon">🔍</div>
                <div className="tab-empty-text">Поиск</div>
                <div className="tab-empty-hint">Введите номер маршрута или название остановки</div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================
            ТАБ: ИЗБРАННОЕ
            ============================================================ */}
        {activeTab === 'favorites' && !selectedRoute && !selectedStop && !searchOpen && (
          <div className="tab-screen">
            <h2>⭐ Избранное</h2>
            {favorites.length === 0 ? (
              <div className="tab-empty">
                <div className="tab-empty-icon">⭐</div>
                <div className="tab-empty-text">Нет избранного</div>
                <div className="tab-empty-hint">Добавляйте маршруты и остановки через ☆ в списке</div>
              </div>
            ) : (
              <div className="favorites-tab-content">
                {/* Избранные маршруты */}
                {favorites.filter(f => f.type === 'route').length > 0 && (
                  <div className="favorites-group">
                    <h4>🚌 Маршруты</h4>
                    <div className="favorites-list">
                      {favorites.filter(f => f.type === 'route').map(fav => {
                        const route = routes.find(r => fav.routeId ? r.route_id === fav.routeId : r.route_short_name === fav.routeName)
                        return (
                        <div
                          key={fav.id}
                          className="favorite-card"
                          onClick={() => {
                            if (route) { handleTabChange('routes'); handleRouteSelect(route) }
                          }}
                        >
                          <div className="favorite-header">
                            <span className={`favorite-route ${route ? getRouteTypeClass(route) : getTypeClassByMeta(fav.routeType, fav.transportType)}`}>{fav.routeName}</span>
                            <button className="favorite-remove" onClick={(e) => { e.stopPropagation(); removeFavorite(fav.id); setFavorites(getFavorites()) }}>✕</button>
                          </div>
                          <div className="favorite-details">
                            <div className="favorite-stop">{fav.routeLongName}</div>
                          </div>
                        </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Избранные остановки */}
                {favorites.filter(f => f.type === 'stop').length > 0 && (
                  <div className="favorites-group">
                    <h4>📍 Остановки</h4>
                    <div className="favorites-list">
                      {(() => {
                        const stopFavs = favorites.filter(f => f.type === 'stop')
                        const grouped = {}
                        stopFavs.forEach(fav => {
                          const key = `${fav.stopName}_${fav.direction}`
                          if (!grouped[key]) {
                            grouped[key] = { stopName: fav.stopName, direction: fav.direction, routes: [] }
                          }
                          grouped[key].routes.push(fav)
                        })
                        return Object.values(grouped).map(group => {
                          const isGroupExpanded = expandedFavGroups.includes(`${group.stopName}_${group.direction}`)
                          return (
                            <div key={`${group.stopName}_${group.direction}`} className="favorite-card-grouped">
                              <div className="favorite-group-header" onClick={() => {
                                const gKey = `${group.stopName}_${group.direction}`
                                setExpandedFavGroups(prev =>
                                  prev.includes(gKey) ? prev.filter(k => k !== gKey) : [...prev, gKey]
                                )
                              }}>
                                <div style={{flex: 1, minWidth: 0}}>
                                  <div className="favorite-group-stop">{group.stopName}</div>
                                  <div className="favorite-group-meta">{group.direction === 0 ? '→ Прямое' : '← Обратное'} · {group.routes.length} марш.</div>
                                </div>
                                <span className={`expand-toggle ${isGroupExpanded ? 'open' : ''}`}>{isGroupExpanded ? '▼' : '▶'}</span>
                              </div>
                              {isGroupExpanded && (
                                <div className="favorite-group-routes">
                                  {(() => {
                                    const FAV_MAX = 3
                                    const gKey = `${group.stopName}_${group.direction}`
                                    const isRoutesExpanded = expandedFavRoutes.includes(gKey)
                                    // Сортируем маршруты по ближайшему рейсу
                                    const sortedRoutes = [...group.routes].sort((a, b) => {
                                      const nextA = favNextDepartures[a.id]
                                      const nextB = favNextDepartures[b.id]
                                      const minA = nextA?.diffMin ?? 9999
                                      const minB = nextB?.diffMin ?? 9999
                                      return minA - minB
                                    })
                                    const visibleFavRoutes = isRoutesExpanded ? sortedRoutes : sortedRoutes.slice(0, FAV_MAX)
                                    const hiddenCount = sortedRoutes.length - FAV_MAX
                                    const hasMoreRoutes = sortedRoutes.length > FAV_MAX
                                    return (
                                      <>
                                        {visibleFavRoutes.map(fav => {
                                    const next = favNextDepartures[fav.id]
                                    return (
                                      <div key={fav.id} className="favorite-route-item fav-with-gps" onClick={() => {
                                        const route = routes.find(r => String(r.route_id) === String(fav.routeId) || r.route_short_name === fav.routeName)
                                        if (route) {
                                          handleTabChange('routes')
                                          navigateToStopSchedule(fav.stopName, route, fav.direction)
                                        }
                                      }}>
                                        {(() => {
                                          const rr = routes.find(r => String(r.route_id) === String(fav.routeId) || r.route_short_name === fav.routeName)
                                          return <span className={`favorite-route-number ${rr ? getRouteTypeClass(rr) : getTypeClassByMeta(fav.routeType, fav.transportType)}`}>{fav.routeName}</span>
                                        })()}
                                        <div style={{flex: 1, minWidth: 0}}>
                                          {/* Расписание */}
                                          {next !== undefined && (
                                            <div style={{display:'flex', alignItems:'center', gap:6}}>
                                              <span style={{fontSize:10, color:'rgba(255,255,255,0.3)', fontWeight:600, minWidth:70, textTransform:'uppercase', letterSpacing:'0.3px'}}>расписание</span>
                                              {next ? (
                                                <span style={{fontSize:13}}>
                                                  <span style={{color:'rgba(255,255,255,0.85)', fontWeight:500}}>{next.time}</span>
                                                  {next.diffMin === 0
                                                    ? <span style={{color:'rgba(255,255,255,0.4)'}}> · сейчас</span>
                                                    : next.diffMin <= 90
                                                      ? <span style={{color:'rgba(255,255,255,0.4)'}}> · {next.diffMin} мин</span>
                                                      : null}
                                                </span>
                                              ) : (
                                                <span style={{color:'rgba(255,255,255,0.25)', fontSize:12}}>нет рейсов</span>
                                              )}
                                            </div>
                                          )}
                                          {/* GPS */}
                                          {fav.stopId && (
                                            <FavForecastLabeled stopId={String(fav.stopId)} routeId={String(fav.routeId)} />
                                          )}
                                        </div>
                                        <button className="favorite-route-remove" onClick={(e) => {
                                          e.stopPropagation()
                                          removeFavorite(fav.id)
                                          setFavorites(getFavorites())
                                          setFavNextDepartures(prev => { const u = { ...prev }; delete u[fav.id]; return u })
                                        }}>✕</button>
                                      </div>
                                    )
                                  })}
                                        {hasMoreRoutes && !isRoutesExpanded && (
                                          <button className="nearby-show-more" onClick={() => setExpandedFavRoutes(prev => [...prev, gKey])}>
                                            Показать ещё {hiddenCount} {hiddenCount === 1 ? 'маршрут' : hiddenCount < 5 ? 'маршрута' : 'маршрутов'}
                                          </button>
                                        )}
                                        {hasMoreRoutes && isRoutesExpanded && (
                                          <button className="nearby-show-more" onClick={() => setExpandedFavRoutes(prev => prev.filter(k => k !== gKey))}>
                                            Скрыть
                                          </button>
                                        )}
                                      </>
                                    )
                                  })()}
                                </div>
                              )}
                            </div>
                          )
                        })
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============================================================
            ТАБ: РЯДОМ
            ============================================================ */}
        {activeTab === 'nearby' && !selectedRoute && !selectedStop && !searchOpen && (
          <div className="tab-screen">
            <div className="tab-screen-header">
              <h2>📍 Остановки рядом</h2>
              {nearbyLoaded && !nearbyLoading && (
                <button className="tab-action-btn" onClick={handleNearbyStops} title="Обновить">🔄</button>
              )}
            </div>

            {/* Первый вход — показываем кнопку вместо автозагрузки */}
            {!nearbyLoaded && !nearbyLoading && !nearbyError && (
              <div className="tab-empty">
                <div className="tab-empty-icon">📍</div>
                <div className="tab-empty-text">Остановки рядом</div>
                <div className="tab-empty-hint">Найдём остановки в радиусе 500м от вас</div>
                <button className="tab-load-btn" onClick={handleNearbyStops}>
                  Найти остановки
                </button>
              </div>
            )}

            {nearbyLoading && <div className="nearby-status tab-status">⏳ Определяем местоположение...</div>}
            {!nearbyLoading && nearbyError && (
              <div className="tab-empty">
                <div className="tab-empty-icon">⚠️</div>
                <div className="tab-empty-text">{nearbyError}</div>
                <button className="tab-load-btn" onClick={handleNearbyStops}>Попробовать снова</button>
              </div>
            )}
            {!nearbyLoading && !nearbyError && nearbyLoaded && nearbyStops.length === 0 && (
              <div className="nearby-status tab-status">Остановок в радиусе 500м не найдено</div>
            )}

            {nearbyStops.length > 0 && (
              <div className="nearby-group">
                {nearbyStops.map(stop => {
                  const stopKey = stop.stop_name
                  const isStopExpanded = nearbyExpandedStops.includes(stopKey)
                  const MAX_ROUTES = 3

                  // Группируем маршруты по direction_group (общая следующая остановка)
                  const dirGroups = {}
                  stop.routes.forEach(route => {
                    const gKey = route.direction_group || (route.direction === 0 ? 'Прямое' : 'Обратное')
                    if (!dirGroups[gKey]) dirGroups[gKey] = []
                    dirGroups[gKey].push(route)
                  })

                  // Сортируем маршруты внутри каждой группы по ближайшему рейсу
                  Object.values(dirGroups).forEach(group => {
                    group.sort((a, b) => {
                      const keyA = `${stop.stop_name}|${a.route_id}|${a.direction}`
                      const keyB = `${stop.stop_name}|${b.route_id}|${b.direction}`
                      const minA = nearbyDepartures[keyA]?.diffMin ?? 9999
                      const minB = nearbyDepartures[keyB]?.diffMin ?? 9999
                      return minA - minB
                    })
                  })

                  // Сортируем группы — сначала та, у которой ближайший рейс раньше
                  const sortedGroupKeys = Object.keys(dirGroups).sort((a, b) => {
                    const bestA = dirGroups[a].reduce((min, r) => {
                      const k = `${stop.stop_name}|${r.route_id}|${r.direction}`
                      return Math.min(min, nearbyDepartures[k]?.diffMin ?? 9999)
                    }, 9999)
                    const bestB = dirGroups[b].reduce((min, r) => {
                      const k = `${stop.stop_name}|${r.route_id}|${r.direction}`
                      return Math.min(min, nearbyDepartures[k]?.diffMin ?? 9999)
                    }, 9999)
                    return bestA - bestB
                  })

                  // Считаем total маршрутов для show more
                  const totalRoutes = stop.routes.length
                  const hiddenCount = totalRoutes - MAX_ROUTES
                  const hasMore = totalRoutes > MAX_ROUTES

                  let routesRemaining = isStopExpanded ? Infinity : MAX_ROUTES

                  return (
                    <div key={stop.stop_name} className="nearby-stop-card">
                      <div className="nearby-stop-header">
                        <div className="nearby-stop-name">{stop.stop_name}</div>
                        <div className="nearby-distance">{stop.distance_m}м</div>
                      </div>
                      <div className="nearby-routes">
                        {sortedGroupKeys.map(gKey => {
                          if (routesRemaining <= 0) return null
                          const groupRoutes = dirGroups[gKey]
                          const visibleInGroup = groupRoutes.slice(0, routesRemaining)
                          routesRemaining -= visibleInGroup.length
                          return (
                            <div key={gKey} className="nearby-direction-group">
                              <div className="nearby-direction-label">к {gKey}</div>
                              {visibleInGroup.map(route => {
                                const key = `${stop.stop_name}|${route.route_id}|${route.direction}`
                                const dep = nearbyDepartures[key]
                                return (
                                  <button key={key} className="nearby-route-chip nearby-chip-with-gps" onClick={() => navigateToStopSchedule(stop.stop_name, route, route.direction)}>
                                    <span className={`nearby-route-num ${getRouteTypeClass(route)}`}>{route.route_short_name}</span>
                                    <span className="nearby-route-info">
                                      <span className="nearby-sched"><span className="nearby-label">расп.</span>{dep === undefined ? '...' : dep === null ? 'нет рейсов' : dep.diffMin === 0 ? `${String(dep.time).substring(0,5)} · сейчас` : dep.diffMin <= 90 ? `${String(dep.time).substring(0,5)} · ${dep.diffMin} мин` : String(dep.time).substring(0,5)}</span>
                                      {stop.stop_id && <FavForecastLabeled stopId={String(stop.stop_id)} routeId={String(route.route_id)} inline={true} />}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          )
                        })}
                        {hasMore && !isStopExpanded && <button className="nearby-show-more" onClick={() => setNearbyExpandedStops(prev => [...prev, stopKey])}>Показать ещё {hiddenCount} {hiddenCount === 1 ? 'маршрут' : hiddenCount < 5 ? 'маршрута' : 'маршрутов'}</button>}
                        {hasMore && isStopExpanded && <button className="nearby-show-more" onClick={() => setNearbyExpandedStops(prev => prev.filter(k => k !== stopKey))}>Скрыть</button>}
                      </div>
                      {stop.stop_id && (
                        <div style={{marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.05)'}}>
                          <FavForecast stopId={String(stop.stop_id)} compact={true} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ============================================================
            ТАБ: ИСТОРИЯ
            ============================================================ */}
        {activeTab === 'history' && !selectedRoute && !selectedStop && !searchOpen && (
          <div className="tab-screen">
            <div className="tab-screen-header">
              <h2>🕐 История</h2>
              {history.length > 0 && (
                <button className="tab-action-btn" onClick={() => { clearHistory(); setHistory([]) }} title="Очистить">🗑</button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="tab-empty">
                <div className="tab-empty-icon">🕐</div>
                <div className="tab-empty-text">История пуста</div>
                <div className="tab-empty-hint">Здесь появятся просмотренные маршруты и остановки</div>
              </div>
            ) : (
              <div className="route-list" style={{padding: '0 16px'}}>
                {history.map(item => {
                  // Ищем маршрут: по routeId (точный) или по имени
                  const route = item.routeId 
                    ? routes.find(r => String(r.route_id) === String(item.routeId))
                    : routes.find(r => r.route_short_name === item.routeName)
                  
                  // CSS-класс: из маршрута или из сохранённого routeType
                  let typeClass = ''
                  if (route) {
                    typeClass = getRouteTypeClass(route)
                  } else if (item.routeType !== undefined) {
                    typeClass = getTypeClassByMeta(item.routeType, item.transportType)
                  }

                  return (
                  <div key={item.id} className="route-card-list" onClick={() => {
                    if (!route) return
                    handleTabChange('routes')
                    if (item.type === 'route') {
                      handleRouteSelect(route)
                    } else {
                      navigateToStopSchedule(item.stopName, route, item.direction, item.dayType)
                    }
                  }}>
                    <div className="route-list-content">
                      <span className={`route-number-list ${typeClass}`}>{item.routeName}</span>
                      <span className="route-name-list">
                        {item.type === 'stop' ? item.stopName : (item.routeLong || '')}
                      </span>
                    </div>
                    <span className="history-item-arrow">›</span>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Живая карта (таб) */}
        {activeTab === 'livemap' && !selectedRoute && !selectedStop && !searchOpen && (
          <LiveMap
            routeId={liveMapRouteId}
            routeName={liveMapRouteName}
            transportType={liveMapTransportType}
            stops={null}
            onClose={() => handleTabChange('routes')}
          />
        )}

        {/* Список остановок */}
        {selectedRoute && !selectedStop && (
          <div className="stops-list">
            <div className="inline-buttons mb-3">
              <button className="action-button" onClick={() => setSelectedRoute(null)}>
                ← Назад
              </button>
              <button
                className="action-button"
                onClick={async () => {
                  setLoading(true)
                  setNextDepartures({})
                  try {
                    const data = await getStops(selectedRoute.route_short_name, direction, selectedRoute.route_id)
                    setStops(data)
                    loadAllNextDepartures(data, selectedRoute.route_short_name, direction, dayType, selectedRoute.route_id)
                  } catch (err) {
                    setError('Не удалось обновить остановки')
                  } finally {
                    setLoading(false)
                  }
                }}
                disabled={loading}
              >
                🔄 Обновить
              </button>
            </div>
            
            <div className="sv2-route-info" style={{marginBottom: '4px'}}>
              <span className={`sv2-route-badge ${getRouteTypeClass(selectedRoute)}`} style={{color: '#fff'}}>
                {selectedRoute.route_short_name}
              </span>
              <span className="sv2-route-dir">
                {direction === 0 ? '→ Прямое направление' : '← Обратное направление'}
              </span>
            </div>
            <p className="route-description mb-4">{getRouteDisplayName(selectedRoute)}</p>
            
            {Object.keys(nextDepartures).length > 0 && Object.keys(nextDepartures).length < stops.length && (
              <p className="next-departures-loading">
                🕐 Загружаем время рейсов... {Object.keys(nextDepartures).length}/{stops.length}
              </p>
            )}
            
            {loading && loadingType === 'stops' ? (
              <SkeletonStops />
            ) : (
              stops.map((stop, index) => {
                const next = nextDepartures[stop.stop_name]
                const isStopFav = isFavorite(
                  selectedRoute.route_short_name,
                  stop.stop_name,
                  direction,
                  dayType
                )

                return (
                  <div
                    key={index}
                    className="stop-card"
                    onClick={(e) => {
                      if (e.target.closest('[data-fav-btn]')) return
                      handleStopSelect(stop)
                    }}
                  >
                    <div className="stop-number">{index + 1}</div>
                    <div className="stop-info">
                      <div className="stop-name">{stop.stop_name}</div>
                      {next && (
                        <div className="stop-next-departure">
                          🕐 {next.time}
                          {next.diffMin <= 60
                            ? ` · через ${next.diffMin} мин`
                            : ''}
                        </div>
                      )}
                    </div>
                    <a
                      href="#"
                      data-fav-btn="1"
                      className={`stop-favorite-btn ${isStopFav ? 'active' : ''}`}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        try {
                          const raw = localStorage.getItem('gtfs_favorites') || '[]'
                          let favs = JSON.parse(raw)
                          const stopId = `${selectedRoute.route_short_name}_${stop.stop_name}_${direction}_${dayType}`
                          const idx = favs.findIndex(f => f.id === stopId)
                          if (idx >= 0) {
                            favs.splice(idx, 1)
                          } else {
                            favs.unshift({
                              routeName: selectedRoute.route_short_name,
                              routeLongName: selectedRoute.route_long_name,
                              routeId: selectedRoute.route_id,
                              stopName: stop.stop_name,
                              stopId: stop.stop_id,
                              direction, dayType, type: 'stop',
                              routeType: selectedRoute.route_type,
                              transportType: selectedRoute.transport_type || 'bus',
                              timestamp: Date.now(),
                              id: stopId
                            })
                            loadNextDeparture(stop)
                          }
                          try {
                            localStorage.setItem('gtfs_favorites', JSON.stringify(favs))
                          } catch (we) {
                            // Quota exceeded — чистим кэш
                            Object.keys(localStorage).filter(k => k.startsWith('gtfs_cache_')).forEach(k => localStorage.removeItem(k))
                            localStorage.setItem('gtfs_favorites', JSON.stringify(favs))
                          }
                          setFavorites(favs)
                        } catch (err) {
                          console.error('Stop favorite error:', err)
                        }
                      }}
                    >
                      {isStopFav ? <span className="fav-star active">★</span> : <span className="fav-star">☆</span>}
                    </a>
                  </div>
                )
              })
            )}
          </div>
        )}


        {/* Расписание — новый дизайн */}
        {selectedStop && (
          <div className="schedule-v2">
            {/* Верхняя панель */}
            <div className="sv2-topbar">
              <span className="sv2-back" onClick={() => setSelectedStop(null)}>‹</span>
              <span className="sv2-topbar-title">Расписание</span>
              <div className="sv2-topbar-actions">
                <span className="sv2-topbar-btn" onClick={() => setShowShareModal(true)}>↗</span>
                <span
                  className={`sv2-topbar-btn ${isFavorite(selectedRoute.route_short_name, selectedStop.stop_name, direction, dayType) ? 'sv2-fav-active' : ''}`}
                  onClick={handleToggleFavorite}
                >
                  {isFavorite(selectedRoute.route_short_name, selectedStop.stop_name, direction, dayType) ? '★' : '☆'}
                </span>
              </div>
            </div>

            {/* Маршрут и направление */}
            <div className="sv2-route-info">
              <span className={`sv2-route-badge ${getRouteTypeClass(selectedRoute)}`} style={{color: '#fff'}}>
                {selectedRoute.route_short_name}
              </span>
              <span className="sv2-route-dir">
                {direction === 0 ? '→ Прямое направление' : '← Обратное направление'}
              </span>
            </div>

            {/* Остановка */}
            <div className="sv2-stop-name">{selectedStop.stop_name}</div>
            <div className="sv2-stop-meta">
              Остановка {(stops.findIndex(s => s.stop_name === selectedStop.stop_name) + 1) || '?'} из {stops.length} · {dayType === 'weekday' ? 'будни' : 'выходные'}
            </div>

            {/* Пилл переключатель будни/выходные */}
            <div className="sv2-pill-toggle">
              <div
                className={`sv2-pill-btn ${dayType === 'weekday' ? 'active' : ''}`}
                onClick={() => {
                  setDayType('weekday')
                  loadScheduleForStop(selectedStop, direction, 'weekday')
                  setTransfers([]); setTransfersLoaded(false); transfersRawRef.current = []
                }}
              >Будни</div>
              <div
                className={`sv2-pill-btn ${dayType === 'weekend' ? 'active' : ''}`}
                onClick={() => {
                  setDayType('weekend')
                  loadScheduleForStop(selectedStop, direction, 'weekend')
                  setTransfers([]); setTransfersLoaded(false); transfersRawRef.current = []
                }}
              >Выходные</div>
            </div>

            {/* Переключатель направления */}
            <div className="sv2-pill-toggle" style={{marginTop: '-8px'}}>
              <div
                className={`sv2-pill-btn ${direction === 0 ? 'active' : ''}`}
                onClick={() => {
                  setDirection(0)
                  loadScheduleForStop(selectedStop, 0, dayType)
                  setTransfers([]); setTransfersLoaded(false); transfersRawRef.current = []
                }}
              >→ Прямое</div>
              <div
                className={`sv2-pill-btn ${direction === 1 ? 'active' : ''}`}
                onClick={() => {
                  setDirection(1)
                  loadScheduleForStop(selectedStop, 1, dayType)
                  setTransfers([]); setTransfersLoaded(false); transfersRawRef.current = []
                }}
              >← Обратное</div>
            </div>

            {loading && loadingType === 'schedule' ? (
              <SkeletonSchedule />
            ) : schedule.length > 0 ? (
              <>
                {/* Ближайшие рейсы */}
                {(() => {
                  const now = new Date()
                  const nowH = now.getHours()
                  const nowM = now.getMinutes()
                  const normalizedNow = nowH < 4 ? (nowH + 24) * 60 + nowM : nowH * 60 + nowM

                  const upcoming = schedule
                    .map(time => {
                      const t = time.substring(0, 5)
                      const [h, m] = t.split(':').map(Number)
                      if (isNaN(h) || isNaN(m)) return null
                      const total = h < 4 ? (h + 24) * 60 + m : h * 60 + m
                      const diff = total - normalizedNow
                      return diff >= 0 ? { time: t, diff } : null
                    })
                    .filter(Boolean)
                    .slice(0, 4)

                  return upcoming.length > 0 ? (
                    <div className="sv2-nearest-section">
                      <div className="sv2-section-label">БЛИЖАЙШИЕ РЕЙСЫ</div>
                      <div className="sv2-nearest-cards">
                        {upcoming.map((item, i) => (
                          <div key={i} className={`sv2-nearest-card ${i === 0 ? 'first' : ''}`}>
                            <div className="sv2-nearest-time">{item.time}</div>
                            <div className="sv2-nearest-diff">{item.diff === 0 ? 'сейчас' : `${item.diff} мин`}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null
                })()}

                {/* 🆕 Прогноз прибытия GTFS-RT */}
                {selectedStop?.stop_id && (
                  <ForecastBlock stopId={selectedStop.stop_id} />
                )}

                {/* Расписание по часам — компактная сетка */}
                <div className="sv2-section-label" style={{marginTop: '16px'}}>РАСПИСАНИЕ ПО ЧАСАМ</div>
                <div className="sv2-hour-grid">
                  {(() => {
                    const byHour = {}
                    const now = new Date()
                    const nowH = now.getHours()
                    const nowM = now.getMinutes()
                    const normalizedNow = nowH < 4 ? (nowH + 24) * 60 + nowM : nowH * 60 + nowM
                    let nearestTime = null
                    let nearestDiff = Infinity

                    schedule.forEach(time => {
                      const hour = time.split(':')[0]
                      if (!byHour[hour]) byHour[hour] = []
                      const t = time.substring(0, 5)
                      byHour[hour].push(t)

                      const [h, m] = t.split(':').map(Number)
                      const total = h < 4 ? (h + 24) * 60 + m : h * 60 + m
                      const diff = total - normalizedNow
                      if (diff >= 0 && diff < nearestDiff) {
                        nearestDiff = diff
                        nearestTime = t
                      }
                    })

                    const sortedHours = Object.keys(byHour).sort((a, b) => {
                      const ha = parseInt(a)
                      const hb = parseInt(b)
                      const ka = ha < 4 ? ha + 24 : ha
                      const kb = hb < 4 ? hb + 24 : hb
                      return ka - kb
                    })

                    return sortedHours.map(hour => (
                      <div key={hour} className="sv2-hour-row">
                        <span className="sv2-hour-label">{hour}</span>
                        <div className="sv2-hour-times">
                          {byHour[hour].map((time, idx) => (
                            <span key={idx} className={`sv2-time-chip${time === nearestTime ? ' nearest' : ''}`}>
                              {time.split(':')[1]}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  })()}
                </div>

                {/* Пересадки на остановке */}
                {!transfersLoading && displayTransfers.length === 0 && !transfersLoaded ? (
                  <div className="transfers-section">
                    <div className="transfers-header" onClick={() => loadTransfers(selectedStop.stop_name, selectedRoute.route_id, dayType)}>
                      <div className="transfers-title">
                        <span className="transfers-icon">🔄</span>
                        Пересадки
                      </div>
                      <span className="expand-toggle">▶</span>
                    </div>
                  </div>
                ) : (
                  <div className="transfers-section">
                    <div className="transfers-header" onClick={() => setTransfersExpanded(prev => !prev)} style={{cursor: 'pointer'}}>
                      <div className="transfers-title">
                        <span className="transfers-icon">🔄</span>
                        Пересадки
                      </div>
                      <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                        {!transfersLoading && displayTransfers.length > 0 && (
                          <span className="transfers-count">{displayTransfers.length} маршрут{displayTransfers.length === 1 ? '' : displayTransfers.length < 5 ? 'а' : 'ов'}</span>
                        )}
                        <span className={`expand-toggle ${transfersExpanded ? 'open' : ''}`}>{transfersExpanded ? '▼' : '▶'}</span>
                      </div>
                    </div>
                    {transfersExpanded && (
                    <div className="transfers-content">
                      {transfersLoading && <div className="transfers-loading">⏳ Загружаем маршруты...</div>}
                      {!transfersLoading && transfersLoaded && displayTransfers.length === 0 && (
                        <div className="transfers-empty">Других маршрутов через эту остановку нет</div>
                      )}
                      {displayTransfers.map((tr, idx) => {
                        const bgClass = tr.transport_type === 'tram' || tr.route_type === 0 ? 'transfer-badge-tram'
                          : tr.transport_type === 'trolley' ? 'transfer-badge-trolley'
                          : 'transfer-badge-bus'
                        let destination = tr.route_long_name || ''
                        if (destination.includes(' - ')) { const parts = destination.split(' - '); destination = parts[parts.length - 1] }
                        
                        const displayTimes = tr.next_times || []
                        if (displayTimes.length === 0) return null

                        // GPS прогноз для этого маршрута на этой остановке — через FavForecast
                        const stopId = selectedStop?.stop_id
                        
                        return (
                          <div key={`${tr.route_id}-${tr.direction}-${idx}`} className="transfer-card"
                            onClick={() => { const route = routes.find(r => String(r.route_id) === String(tr.route_id)); if (route) navigateToStopSchedule(selectedStop.stop_name, route, tr.direction, dayType) }}>
                            <span className={`transfer-badge ${bgClass}`} style={{color: '#fff'}}>{tr.route_short_name}</span>
                            <div className="transfer-info">
                              <div className="transfer-destination">→ {destination}</div>
                              <div className="transfer-times">
                                {displayTimes.map((nt, i) => (
                                  <span key={i} className={`transfer-time-chip ${i === 0 ? 'first' : ''}`}
                                    title="По расписанию">{nt.time}</span>
                                ))}
                              </div>
                              {stopId && (
                                <FavForecast stopId={String(stopId)} routeId={String(tr.route_id)} compact={true} />
                              )}
                            </div>
                            <span className="transfer-wait">{displayTimes[0]?.diff_min === 0 ? 'сейчас' : `${displayTimes[0]?.diff_min} мин`}</span>
                            <span className="transfer-arrow">›</span>
                          </div>
                        )
                      })}
                    </div>
                    )}
                  </div>
                )}

                {/* Статистика и графики */}
                <StatsTabs route={selectedRoute} stop={selectedStop} direction={direction} dayType={dayType} schedule={schedule} stops={stops} onStopClick={handleStopSelect} />
              </> 
            ) : (
              <div className="info">ℹ️ Нет расписания для выбранных параметров</div>
            )}
          </div>
        )}

        {/* Toast уведомление */}
        {shareToast && (
          <div className="share-toast">{shareToast}</div>
        )}

        {/* Модальное окно шаринга */}
        {showShareModal && (
          <div className="theme-modal-overlay" onClick={() => setShowShareModal(false)}>
            <div className="theme-modal share-modal" onClick={e => e.stopPropagation()}>
              <div className="theme-modal-header">
                <h3>↗️ Поделиться расписанием</h3>
                <button className="theme-modal-close" onClick={() => setShowShareModal(false)}>✕</button>
              </div>

              <div className="share-preview">
                <div className="share-preview-label">Маршрут {selectedRoute?.route_short_name}</div>
                <div className="share-preview-stop">📍 {selectedStop?.stop_name}</div>
                {getNextDepartures(3).length > 0 && (
                  <div className="share-preview-times">
                    🕐 Ближайшие: {getNextDepartures(3).join(', ')}
                  </div>
                )}
              </div>

              <div className="share-options">
                <button
                  className="share-option-btn"
                  onClick={() => handleShare('next')}
                >
                  <span className="share-option-icon">🕐</span>
                  <div className="share-option-text">
                    <div className="share-option-title">Ближайшие 3 рейса</div>
                    <div className="share-option-desc">Короткое сообщение</div>
                  </div>
                  <span className="share-option-arrow">›</span>
                </button>

                <button
                  className="share-option-btn"
                  onClick={() => handleShare('full')}
                >
                  <span className="share-option-icon">📋</span>
                  <div className="share-option-text">
                    <div className="share-option-title">Полное расписание</div>
                    <div className="share-option-desc">Все рейсы на день</div>
                  </div>
                  <span className="share-option-arrow">›</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Экран истории просмотров */}
        {/* Модальное окно выбора темы */}
        {showThemeSelector && (
          <ThemeSelector
            currentTheme={currentTheme}
            onThemeChange={handleThemeChange}
            onClose={() => setShowThemeSelector(false)}
          />
        )}
      </div>

      {/* ============================================================
          НИЖНЕЕ МЕНЮ — iOS Telegram-style
          ============================================================ */}
      {!selectedRoute && !selectedStop && (
        <div className="bottom-bar-wrapper">
          {searchOpen ? (
            /* Режим поиска: строка ввода + кнопка закрытия */
            <div className="bottom-search-bar">
              <div className="bottom-search-input-wrap">
                <span className="bottom-search-icon">🔍</span>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Маршрут или остановка..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bottom-search-input"
                />
              </div>
              <button className="bottom-search-close" onClick={handleSearchToggle}>
                ✕
              </button>
            </div>
          ) : (
            /* Обычный режим: табы + кнопка поиска */
            <>
              <nav className="bottom-tab-bar">
                <button
                  className={`bottom-tab ${activeTab === 'routes' ? 'active' : ''}`}
                  onClick={() => handleTabChange('routes')}
                >
                  <span className="bottom-tab-icon">🚌</span>
                  <span className="bottom-tab-label">Маршруты</span>
                </button>
                <button
                  className={`bottom-tab ${activeTab === 'favorites' ? 'active' : ''}`}
                  onClick={() => handleTabChange('favorites')}
                >
                  <span className="bottom-tab-icon">⭐</span>
                  <span className="bottom-tab-label">Избранное</span>
                  {favorites.length > 0 && <span className="bottom-tab-badge">{favorites.length}</span>}
                </button>
                <button
                  className={`bottom-tab ${activeTab === 'nearby' ? 'active' : ''}`}
                  onClick={() => handleTabChange('nearby')}
                >
                  <span className="bottom-tab-icon">📍</span>
                  <span className="bottom-tab-label">Рядом</span>
                </button>
                <button
                  className={`bottom-tab ${activeTab === 'livemap' ? 'active' : ''}`}
                  onClick={() => {
                    handleTabChange('livemap')
                    setShowLiveMap(true)
                    setLiveMapRouteId(null)
                    setLiveMapRouteName(null)
                    setLiveMapTransportType(null)
                  }}
                >
                  <span className="bottom-tab-icon">🛰️</span>
                  <span className="bottom-tab-label">Карта</span>
                </button>
                <button
                  className={`bottom-tab ${activeTab === 'history' ? 'active' : ''}`}
                  onClick={() => handleTabChange('history')}
                >
                  <span className="bottom-tab-icon">🕐</span>
                  <span className="bottom-tab-label">История</span>
                  {history.length > 0 && <span className="bottom-tab-badge">{history.length}</span>}
                </button>
              </nav>
              <button className="bottom-search-btn" onClick={handleSearchToggle}>
                <span>🔍</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Кнопка наверх — fixed, над кнопкой поиска */}
      {showScrollTop && !searchOpen && (
        <button
          className="scroll-top-btn"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Наверх"
        >
          ↑
        </button>
      )}

    </div>
  )
}

export default App
