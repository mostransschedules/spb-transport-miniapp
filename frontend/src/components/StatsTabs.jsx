// =============================================================================
// STATS TABS - С карточками статистики маршрута (мокап)
// =============================================================================

import { useState, useEffect } from 'react'
import { Line, Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'
import { getIntervals, getDurations } from '../utils/api'
import RouteMap from './RouteMap'
import LiveMap from './LiveMap'
import './StatsTabs.css'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

// =============================================================================
// Карточки статистики маршрута — вкладка "Стат."
// =============================================================================
function RouteStatsCards({ schedule, stops, intervals, durations, dayType }) {
  if (!schedule || schedule.length === 0) {
    return (
      <div className="info" style={{ marginTop: 12 }}>
        ℹ️ Нет данных для отображения статистики
      </div>
    )
  }

  // Первый и последний рейс
  const normalize = (timeStr) => {
    const [h, m] = timeStr.substring(0, 5).split(':').map(Number)
    return h < 4 ? (h + 24) * 60 + m : h * 60 + m
  }

  const sorted = [...schedule].sort((a, b) => normalize(a) - normalize(b))
  const firstTrip = sorted[0]?.substring(0, 5) || '—'
  const lastTrip = sorted[sorted.length - 1]?.substring(0, 5) || '—'

  // Рейсов в день
  const tripsCount = schedule.length

  // Остановок
  const stopsCount = stops?.length || '—'

  // Пиковый интервал (минимальный из intervals)
  let peakInterval = '—'
  if (intervals?.min_intervals) {
    const filtered = intervals.min_intervals.filter(i => i > 0)
    if (filtered.length > 0) {
      peakInterval = Math.min(...filtered) + ' мин'
    }
  }

  // Среднее время рейса
  let avgDuration = '—'
  if (durations?.average) {
    avgDuration = Math.round(durations.average) + ' мин'
  }

  const cards = [
    { icon: '🗓️', label: 'Рейсов в день', value: tripsCount },
    { icon: '🕐', label: 'Первый рейс', value: firstTrip },
    { icon: '🕙', label: 'Последний рейс', value: lastTrip },
    { icon: '🚏', label: 'Остановок', value: stopsCount },
    { icon: '⚡', label: 'Пиковый интервал', value: peakInterval },
    { icon: '⏱️', label: 'Время в пути', value: avgDuration },
  ]

  return (
    <div style={{ marginTop: 8 }}>
      <div className="stats-cards-grid">
        {cards.map((card, i) => (
          <div key={i} className="stats-info-card">
            <div className="stats-info-icon">{card.icon}</div>
            <div className="stats-info-value">{card.value}</div>
            <div className="stats-info-label">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Дополнительная секция: часы пик */}
      {intervals?.hours && intervals.min_intervals && (() => {
        // Находим час с минимальным интервалом (пик загруженности)
        const minVal = Math.min(...intervals.min_intervals.filter(i => i > 0))
        const peakIdx = intervals.min_intervals.indexOf(minVal)
        const peakHour = peakIdx >= 0 ? intervals.hours[peakIdx] : null

        return peakHour !== null ? (
          <div className="stats-peak-row">
            <span className="stats-peak-label">📈 Час пик</span>
            <span className="stats-peak-value">{peakHour}:00 — интервал {minVal} мин</span>
          </div>
        ) : null
      })()}

      {/* Минимальное / максимальное время рейса */}
      {durations?.min && durations?.max && (
        <div className="stats-duration-row">
          <div className="stats-duration-item">
            <span className="stats-duration-label">Мин. время рейса</span>
            <span className="stats-duration-val">{durations.min} мин</span>
          </div>
          <div className="stats-duration-sep" />
          <div className="stats-duration-item">
            <span className="stats-duration-label">Макс. время рейса</span>
            <span className="stats-duration-val">{durations.max} мин</span>
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Основной компонент
// =============================================================================
function StatsTabs({ route, stop, direction, dayType, schedule, stops, onStopClick }) {
  const [activeTab, setActiveTab] = useState('stats')
  const [intervals, setIntervals] = useState(null)
  const [durations, setDurations] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expandedMin, setExpandedMin] = useState(false)
  const [expandedMax, setExpandedMax] = useState(false)
  const [expandedIntervalMin, setExpandedIntervalMin] = useState(false)
  const [expandedIntervalMax, setExpandedIntervalMax] = useState(false)

  const chartRef = { current: null }

  useEffect(() => {
    if (route && stop) {
      loadData()
    }
  }, [route, stop, direction, dayType])

  const loadData = async () => {
    setLoading(true)
    try {
      const intervalsData = await getIntervals(
        route.route_short_name,
        stop.stop_name,
        direction,
        dayType,
        route.route_id
      )
      setIntervals(intervalsData)

      const durationsData = await getDurations(
        route.route_short_name,
        direction,
        dayType,
        route.route_id
      )
      setDurations(durationsData)
    } catch (err) {
      console.error('Ошибка загрузки статистики:', err)
    } finally {
      setLoading(false)
    }
  }

  const getAllTimeRangesForDuration = (durations, value) => {
    if (!durations.trips) return []
    const matchingTrips = durations.trips.filter(t => t.duration === value)
    if (matchingTrips.length === 0) return []
    const times = matchingTrips.map(t => t.first_time.substring(0, 5)).sort((a, b) => {
      const [ha, ma] = a.split(':').map(Number)
      const [hb, mb] = b.split(':').map(Number)
      const ka = ha < 4 ? ha + 24 : ha
      const kb = hb < 4 ? hb + 24 : hb
      return (ka * 60 + ma) - (kb * 60 + mb)
    })
    if (times.length === 1) return [`в ${times[0]}`]
    const ranges = []
    let rangeStart = times[0]
    let rangeLast = times[0]
    for (let i = 1; i < times.length; i++) {
      const [h1, m1] = rangeLast.split(':').map(Number)
      const [h2, m2] = times[i].split(':').map(Number)
      const diff = Math.abs((h2 * 60 + m2) - (h1 * 60 + m1))
      if (diff < 120) { rangeLast = times[i] }
      else { ranges.push(`с ${rangeStart} до ${rangeLast}`); rangeStart = times[i]; rangeLast = times[i] }
    }
    ranges.push(`с ${rangeStart} до ${rangeLast}`)
    return ranges
  }

  const getAllTimeRangesForInterval = (intervals, targetValue) => {
    if (!intervals || !schedule || schedule.length === 0) return []
    const times = schedule.map(t => t.substring(0, 5))
    const intervalsData = []
    for (let i = 1; i < times.length; i++) {
      const [h1, m1] = times[i - 1].split(':').map(Number)
      const [h2, m2] = times[i].split(':').map(Number)
      let interval = (h2 * 60 + m2) - (h1 * 60 + m1)
      if (interval < 0) interval += 24 * 60
      if (interval > 0 && interval < 180) intervalsData.push({ time: times[i], interval })
    }
    const matchingTimes = intervalsData.filter(item => item.interval === targetValue).map(item => item.time)
    if (matchingTimes.length === 0) return []
    const sortedTimes = matchingTimes.sort((a, b) => {
      const [ha, ma] = a.split(':').map(Number)
      const [hb, mb] = b.split(':').map(Number)
      const ka = ha < 4 ? ha + 24 : ha
      const kb = hb < 4 ? hb + 24 : hb
      return (ka * 60 + ma) - (kb * 60 + mb)
    })
    if (sortedTimes.length === 1) return [`в ${sortedTimes[0]}`]
    const ranges = []
    let rangeStart = sortedTimes[0]
    let rangeLast = sortedTimes[0]
    for (let i = 1; i < sortedTimes.length; i++) {
      const [h1, m1] = rangeLast.split(':').map(Number)
      const [h2, m2] = sortedTimes[i].split(':').map(Number)
      const t1 = (h1 < 4 ? h1 + 24 : h1) * 60 + m1
      const t2 = (h2 < 4 ? h2 + 24 : h2) * 60 + m2
      const diff = t2 - t1
      if (Math.abs(diff - targetValue) <= 2) { rangeLast = sortedTimes[i] }
      else {
        ranges.push(rangeStart === rangeLast ? `в ${rangeStart}` : `с ${rangeStart} до ${rangeLast}`)
        rangeStart = sortedTimes[i]; rangeLast = sortedTimes[i]
      }
    }
    ranges.push(rangeStart === rangeLast ? `в ${rangeStart}` : `с ${rangeStart} до ${rangeLast}`)
    return ranges
  }

  const getIntervalsChartData = () => {
    if (!intervals) return null
    const sortedIndices = intervals.hours.map((h, i) => ({ hour: h, index: i }))
      .sort((a, b) => {
        const ha = a.hour < 4 ? a.hour + 24 : a.hour
        const hb = b.hour < 4 ? b.hour + 24 : b.hour
        return ha - hb
      })
    const sortedHours = sortedIndices.map(x => `${x.hour}:00`)
    const sortedMin = sortedIndices.map(x => intervals.min_intervals[x.index])
    const sortedMax = sortedIndices.map(x => intervals.max_intervals[x.index])
    return {
      labels: sortedHours,
      datasets: [
        { label: 'Минимальный интервал', data: sortedMin, borderColor: 'rgb(75, 192, 192)', backgroundColor: 'rgba(75, 192, 192, 0.2)', fill: true, tension: 0.4 },
        { label: 'Максимальный интервал', data: sortedMax, borderColor: 'rgb(255, 140, 0)', backgroundColor: 'rgba(255, 140, 0, 0.2)', fill: true, tension: 0.4 }
      ]
    }
  }

  const getDurationsChartData = () => {
    if (!durations || !durations.trips) return null
    const sortedTrips = [...durations.trips].sort((a, b) => {
      const [ha, ma] = a.first_time.split(':').map(Number)
      const [hb, mb] = b.first_time.split(':').map(Number)
      const ka = ha < 4 ? ha + 24 : ha
      const kb = hb < 4 ? hb + 24 : hb
      return (ka * 60 + ma) - (kb * 60 + mb)
    })
    return {
      labels: sortedTrips.map(t => t.first_time.substring(0, 5)),
      datasets: [{ label: 'Время рейса (мин)', data: sortedTrips.map(t => t.duration), backgroundColor: 'rgba(54, 162, 235, 0.5)', borderColor: 'rgb(54, 162, 235)', borderWidth: 1 }]
    }
  }

  const isWhiteTheme = document.documentElement.classList.contains('theme-white')
  const isDarkTheme = document.documentElement.classList.contains('theme-black') ||
    document.documentElement.classList.contains('theme-glass') ||
    document.documentElement.classList.contains('theme-black-glass')
  const textColor = isWhiteTheme ? '#000000' : isDarkTheme ? '#ffffff' : (window.Telegram?.WebApp?.themeParams?.text_color || '#ffffff')
  const gridColor = isWhiteTheme ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: textColor } } },
    scales: {
      x: { ticks: { color: textColor }, grid: { color: gridColor } },
      y: { ticks: { color: textColor }, grid: { color: gridColor } }
    }
  }

  return (
    <div className="stats-tabs">
      <div className="tabs-header">
        <button className={activeTab === 'stats' ? 'active' : ''} onClick={() => setActiveTab('stats')}>
          Стат.
        </button>
        <button className={activeTab === 'intervals' ? 'active' : ''} onClick={() => setActiveTab('intervals')}>
          Интервалы
        </button>
        <button className={activeTab === 'durations' ? 'active' : ''} onClick={() => setActiveTab('durations')}>
          Время
        </button>
        <button className={activeTab === 'map' ? 'active' : ''} onClick={() => setActiveTab('map')}>
          Карта
        </button>
      </div>

      <div className="tabs-content">
        {loading ? (
          <div className="text-center mt-3">
            <div className="spinner"></div>
            <p className="mt-2">Загрузка статистики...</p>
          </div>
        ) : (
          <>
            {/* ── Стат. ── */}
            {activeTab === 'stats' && (
              <div className="tab-panel">
                <h3>Статистика маршрута</h3>
                <RouteStatsCards
                  schedule={schedule}
                  stops={stops}
                  intervals={intervals}
                  durations={durations}
                  dayType={dayType}
                />
              </div>
            )}

            {/* ── Интервалы ── */}
            {activeTab === 'intervals' && (
              <div className="tab-panel">
                <div className="chart-header">
                  <h3>График интервалов по часам</h3>
                </div>
                {intervals && getIntervalsChartData() ? (
                  <>
                    {/* Карточки пикового интервала */}
                    {intervals.min_intervals && (() => {
                      const filtered = intervals.min_intervals.filter(i => i > 0)
                      const minInterval = Math.min(...filtered)
                      const maxInterval = Math.max(...intervals.max_intervals)
                      const avgInterval = (filtered.reduce((a, b) => a + b, 0) / filtered.length).toFixed(1)
                      return (
                        <div className="duration-cards" style={{ marginBottom: 12 }}>
                          <div className="duration-card">
                            <div className="duration-card-label">Среднее</div>
                            <div className="duration-card-value">{avgInterval}</div>
                            <div className="duration-card-time">мин</div>
                          </div>
                          <div className="duration-card">
                            <div className="duration-card-label">Минимум (пик)</div>
                            <div className="duration-card-value">{minInterval}</div>
                            <div className="duration-card-time">
                              {getAllTimeRangesForInterval(intervals, minInterval)[0] || ''}
                            </div>
                          </div>
                          <div className="duration-card">
                            <div className="duration-card-label">Максимум</div>
                            <div className="duration-card-value">{maxInterval}</div>
                            <div className="duration-card-time">мин</div>
                          </div>
                        </div>
                      )
                    })()}
                    <div className="chart-container">
                      <Line ref={chartRef} data={getIntervalsChartData()} options={chartOptions} />
                    </div>
                  </>
                ) : (
                  <div className="info">ℹ️ Нет данных об интервалах</div>
                )}
              </div>
            )}

            {/* ── Время рейсов ── */}
            {activeTab === 'durations' && (
              <div className="tab-panel">
                <h3>Время выполнения рейсов</h3>
                {durations && durations.trips && durations.trips.length > 0 ? (
                  <>
                    <div className="duration-cards">
                      <div className="duration-card">
                        <div className="duration-card-label">Среднее время</div>
                        <div className="duration-card-value">{durations.average.toFixed(1)} мин</div>
                      </div>
                      <div className="duration-card">
                        <div className="duration-card-label">Минимальное</div>
                        <div className="duration-card-value">{durations.min} мин</div>
                        <div className="duration-card-time">
                          {getAllTimeRangesForDuration(durations, durations.min).length === 1 ? (
                            getAllTimeRangesForDuration(durations, durations.min)[0]
                          ) : (
                            <>
                              <button className="expand-btn" onClick={() => setExpandedMin(!expandedMin)}>
                                {expandedMin ? '▼' : '▶'} {getAllTimeRangesForDuration(durations, durations.min).length} периода
                              </button>
                              {expandedMin && (
                                <div className="time-ranges-list">
                                  {getAllTimeRangesForDuration(durations, durations.min).map((range, i) => <div key={i}>{range}</div>)}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="duration-card">
                        <div className="duration-card-label">Максимальное</div>
                        <div className="duration-card-value">{durations.max} мин</div>
                        <div className="duration-card-time">
                          {getAllTimeRangesForDuration(durations, durations.max).length === 1 ? (
                            getAllTimeRangesForDuration(durations, durations.max)[0]
                          ) : (
                            <>
                              <button className="expand-btn" onClick={() => setExpandedMax(!expandedMax)}>
                                {expandedMax ? '▼' : '▶'} {getAllTimeRangesForDuration(durations, durations.max).length} периода
                              </button>
                              {expandedMax && (
                                <div className="time-ranges-list">
                                  {getAllTimeRangesForDuration(durations, durations.max).map((range, i) => <div key={i}>{range}</div>)}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="chart-container">
                      <Bar data={getDurationsChartData()} options={chartOptions} />
                    </div>
                  </>
                ) : (
                  <div className="info">ℹ️ Нет данных о времени рейсов</div>
                )}
              </div>
            )}

            {/* ── Карта ── */}
            {activeTab === 'map' && (
              <div className="tab-panel">
                <h3>Карта маршрута</h3>
                <RouteMap stops={stops || []} selectedStop={stop} onStopClick={onStopClick} />
                {route?.route_id && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 600, color: 'var(--tg-hint)',
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                      marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6
                    }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%', background: '#4caf50',
                        display: 'inline-block', boxShadow: '0 0 5px #4caf50'
                      }} />
                      Транспорт на маршруте сейчас
                    </div>
                    <div style={{ borderRadius: 12, overflow: 'hidden' }}>
                      <LiveMap
                        routeId={route.route_id}
                        routeName={route.route_short_name}
                        transportType={route.transport_type}
                        stops={stops}
                        onClose={null}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default StatsTabs
