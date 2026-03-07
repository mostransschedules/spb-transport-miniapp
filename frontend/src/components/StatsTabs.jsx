// =============================================================================
// STATS TABS - Улучшенная версия с всеми фичами
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

function StatsTabs({ route, stop, direction, dayType, schedule, stops, onStopClick }) {
  const [activeTab, setActiveTab] = useState('intervals')
  const [intervals, setIntervals] = useState(null)
  const [durations, setDurations] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expandedMin, setExpandedMin] = useState(false)
  const [expandedMax, setExpandedMax] = useState(false)
  const [expandedIntervalMin, setExpandedIntervalMin] = useState(false)
  const [expandedIntervalMax, setExpandedIntervalMax] = useState(false)
  
  const chartRef = { current: null }

  // Сброс zoom
  const resetZoom = () => {
    if (chartRef.current) {
      chartRef.current.resetZoom()
    }
  }

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
      console.log('Intervals data:', intervalsData)
      setIntervals(intervalsData)

      const durationsData = await getDurations(
        route.route_short_name,
        direction,
        dayType,
        route.route_id
      )
      console.log('Durations data:', durationsData)
      setDurations(durationsData)
    } catch (err) {
      console.error('Ошибка загрузки статистики:', err)
    } finally {
      setLoading(false)
    }
  }

  // Получить все диапазоны времени для значения (хронологически)
  const getAllTimeRangesForDuration = (durations, value) => {
    if (!durations.trips) return []
    
    const matchingTrips = durations.trips.filter(t => t.duration === value)
    if (matchingTrips.length === 0) return []
    
    // Группируем последовательные рейсы в диапазоны
    const times = matchingTrips.map(t => t.first_time.substring(0, 5)).sort((a, b) => {
      const [ha, ma] = a.split(':').map(Number)
      const [hb, mb] = b.split(':').map(Number)
      const ka = ha < 4 ? ha + 24 : ha
      const kb = hb < 4 ? hb + 24 : hb
      return (ka * 60 + ma) - (kb * 60 + mb)
    })
    
    // Если одно время
    if (times.length === 1) {
      return [`в ${times[0]}`]
    }
    
    // Группируем в диапазоны (если времена близко - в один диапазон)
    const ranges = []
    let rangeStart = times[0]
    let rangeLast = times[0]
    
    for (let i = 1; i < times.length; i++) {
      const [h1, m1] = rangeLast.split(':').map(Number)
      const [h2, m2] = times[i].split(':').map(Number)
      
      const diff = Math.abs((h2 * 60 + m2) - (h1 * 60 + m1))
      
      if (diff < 120) { // Если разница < 2 часов - в один диапазон
        rangeLast = times[i]
      } else {
        ranges.push(`с ${rangeStart} до ${rangeLast}`)
        rangeStart = times[i]
        rangeLast = times[i]
      }
    }
    ranges.push(`с ${rangeStart} до ${rangeLast}`)
    
    return ranges
  }

  // Получить все диапазоны для интервалов (используя реальные времена из расписания)
  const getAllTimeRangesForInterval = (intervals, targetValue, isMin = true) => {
    if (!intervals || !schedule || schedule.length === 0) return []
    
    // Вычисляем интервалы между всеми временами в расписании
    const times = schedule.map(t => t.substring(0, 5))
    const intervalsData = []
    
    for (let i = 1; i < times.length; i++) {
      const [h1, m1] = times[i-1].split(':').map(Number)
      const [h2, m2] = times[i].split(':').map(Number)
      
      // Вычисляем интервал в минутах
      let interval = (h2 * 60 + m2) - (h1 * 60 + m1)
      if (interval < 0) interval += 24 * 60 // Переход через полночь
      
      if (interval > 0 && interval < 180) { // Игнорируем слишком большие
        intervalsData.push({
          time: times[i],
          interval: interval
        })
      }
    }
    
    // Находим все времена с нужным интервалом
    const matchingTimes = intervalsData
      .filter(item => item.interval === targetValue)
      .map(item => item.time)
    
    if (matchingTimes.length === 0) return []
    
    // Сортируем хронологически
    const sortedTimes = matchingTimes.sort((a, b) => {
      const [ha, ma] = a.split(':').map(Number)
      const [hb, mb] = b.split(':').map(Number)
      const ka = ha < 4 ? ha + 24 : ha
      const kb = hb < 4 ? hb + 24 : hb
      return (ka * 60 + ma) - (kb * 60 + mb)
    })
    
    // Если одно время
    if (sortedTimes.length === 1) {
      return [`в ${sortedTimes[0]}`]
    }
    
    // Группируем последовательные времена в диапазоны
    const ranges = []
    let rangeStart = sortedTimes[0]
    let rangeLast = sortedTimes[0]
    
    for (let i = 1; i < sortedTimes.length; i++) {
      const [h1, m1] = rangeLast.split(':').map(Number)
      const [h2, m2] = sortedTimes[i].split(':').map(Number)
      
      // Вычисляем разницу в минутах
      const t1 = (h1 < 4 ? h1 + 24 : h1) * 60 + m1
      const t2 = (h2 < 4 ? h2 + 24 : h2) * 60 + m2
      const diff = t2 - t1
      
      // Если разница примерно равна интервалу (±2 минуты) - продолжаем диапазон
      if (Math.abs(diff - targetValue) <= 2) {
        rangeLast = sortedTimes[i]
      } else {
        // Сохраняем диапазон
        if (rangeStart === rangeLast) {
          ranges.push(`в ${rangeStart}`)
        } else {
          ranges.push(`с ${rangeStart} до ${rangeLast}`)
        }
        rangeStart = sortedTimes[i]
        rangeLast = sortedTimes[i]
      }
    }
    
    // Последний диапазон
    if (rangeStart === rangeLast) {
      ranges.push(`в ${rangeStart}`)
    } else {
      ranges.push(`с ${rangeStart} до ${rangeLast}`)
    }
    
    return ranges
  }

  // Данные для графика интервалов (сортировка от первого рейса)
  const getIntervalsChartData = () => {
    if (!intervals) return null

    // Сортируем часы начиная с 4:00
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
        {
          label: 'Минимальный интервал',
          data: sortedMin,
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Максимальный интервал',
          data: sortedMax,
          borderColor: 'rgb(255, 140, 0)',
          backgroundColor: 'rgba(255, 140, 0, 0.2)',
          fill: true,
          tension: 0.4
        }
      ]
    }
  }

  // Данные для графика времени рейсов (сортировка хронологически)
  const getDurationsChartData = () => {
    if (!durations || !durations.trips) return null

    // Сортируем рейсы хронологически (начиная с 4:00 утра)
    const sortedTrips = [...durations.trips].sort((a, b) => {
      const [ha, ma] = a.first_time.split(':').map(Number)
      const [hb, mb] = b.first_time.split(':').map(Number)
      const ka = ha < 4 ? ha + 24 : ha
      const kb = hb < 4 ? hb + 24 : hb
      return (ka * 60 + ma) - (kb * 60 + mb)
    })

    const labels = sortedTrips.map(t => t.first_time.substring(0, 5)) // чч:мм формат
    const data = sortedTrips.map(t => t.duration)

    return {
      labels,
      datasets: [
        {
          label: 'Время рейса (мин)',
          data,
          backgroundColor: 'rgba(54, 162, 235, 0.5)',
          borderColor: 'rgb(54, 162, 235)',
          borderWidth: 1
        }
      ]
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
    plugins: {
      legend: {
        labels: {
          color: textColor
        }
      }
    },
    scales: {
      x: {
        ticks: { color: textColor },
        grid: { color: gridColor }
      },
      y: {
        ticks: { color: textColor },
        grid: { color: gridColor }
      }
    }
  }

  return (
    <div className="stats-tabs">
      <div className="tabs-header">
        <button
          className={activeTab === 'intervals' ? 'active' : ''}
          onClick={() => setActiveTab('intervals')}
        >
          Интервалы
        </button>
        <button
          className={activeTab === 'durations' ? 'active' : ''}
          onClick={() => setActiveTab('durations')}
        >
          Время рейсов
        </button>
        <button
          className={activeTab === 'map' ? 'active' : ''}
          onClick={() => setActiveTab('map')}
        >
          Карта
        </button>
        <button
          className={activeTab === 'stats' ? 'active' : ''}
          onClick={() => setActiveTab('stats')}
        >
          Статистика
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
            {activeTab === 'intervals' && (
              <div className="tab-panel">
                <div className="chart-header">
                  <h3>График интервалов по часам</h3>
                </div>
                {intervals && getIntervalsChartData() ? (
                  <div className="chart-container">
                    <Line 
                      ref={chartRef}
                      data={getIntervalsChartData()} 
                      options={chartOptions}
                    />
                  </div>
                ) : (
                  <div className="info">
                    ℹ️ Нет данных об интервалах
                  </div>
                )}
              </div>
            )}

            {activeTab === 'durations' && (
              <div className="tab-panel">
                <h3>Время выполнения рейсов</h3>
                {durations && durations.trips && durations.trips.length > 0 ? (
                  <>
                    {/* Карточки */}
                    <div className="duration-cards">
                      <div className="duration-card">
                        <div className="duration-card-label">Среднее время</div>
                        <div className="duration-card-value">{durations.average.toFixed(1)} мин</div>
                      </div>
                      
                      {/* Минимальное */}
                      <div className="duration-card">
                        <div className="duration-card-label">Минимальное время</div>
                        <div className="duration-card-value">{durations.min} мин</div>
                        <div className="duration-card-time">
                          {getAllTimeRangesForDuration(durations, durations.min).length === 1 ? (
                            getAllTimeRangesForDuration(durations, durations.min)[0]
                          ) : (
                            <>
                              <button 
                                className="expand-btn"
                                onClick={() => setExpandedMin(!expandedMin)}
                              >
                                {expandedMin ? '▼' : '▶'} {getAllTimeRangesForDuration(durations, durations.min).length} периода
                              </button>
                              {expandedMin && (
                                <div className="time-ranges-list">
                                  {getAllTimeRangesForDuration(durations, durations.min).map((range, i) => (
                                    <div key={i}>{range}</div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* Максимальное */}
                      <div className="duration-card">
                        <div className="duration-card-label">Максимальное время</div>
                        <div className="duration-card-value">{durations.max} мин</div>
                        <div className="duration-card-time">
                          {getAllTimeRangesForDuration(durations, durations.max).length === 1 ? (
                            getAllTimeRangesForDuration(durations, durations.max)[0]
                          ) : (
                            <>
                              <button 
                                className="expand-btn"
                                onClick={() => setExpandedMax(!expandedMax)}
                              >
                                {expandedMax ? '▼' : '▶'} {getAllTimeRangesForDuration(durations, durations.max).length} периода
                              </button>
                              {expandedMax && (
                                <div className="time-ranges-list">
                                  {getAllTimeRangesForDuration(durations, durations.max).map((range, i) => (
                                    <div key={i}>{range}</div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="chart-container">
                      <Bar 
                        data={getDurationsChartData()} 
                        options={chartOptions}
                      />
                    </div>
                  </>
                ) : (
                  <div className="info">
                    ℹ️ Нет данных о времени рейсов
                  </div>
                )}
              </div>
            )}

            {/* Вкладка: Статистика */}
            {activeTab === 'stats' && (
              <div className="tab-panel">
                <h3>Общая статистика</h3>
                
                {intervals && (
                  <div className="stats-card">
                    <h4>📊 Интервалы движения</h4>
                    <div className="stat-item">
                      <span className="stat-label">Средний интервал:</span>
                      <span className="stat-value">
                        {(
                          intervals.min_intervals.filter(i => i > 0).reduce((a, b) => a + b, 0) /
                          intervals.min_intervals.filter(i => i > 0).length
                        ).toFixed(1)} мин
                      </span>
                    </div>
                    
                    {/* Минимальный интервал */}
                    <div className="stat-item">
                      <span className="stat-label">Минимальный:</span>
                      <span className="stat-value">
                        {Math.min(...intervals.min_intervals.filter(i => i > 0))} мин
                        <span className="stat-time">
                          {getAllTimeRangesForInterval(intervals, Math.min(...intervals.min_intervals.filter(i => i > 0)), true).length === 1 ? (
                            <div>{getAllTimeRangesForInterval(intervals, Math.min(...intervals.min_intervals.filter(i => i > 0)), true)[0]}</div>
                          ) : (
                            <>
                              <button 
                                className="expand-btn"
                                onClick={() => setExpandedIntervalMin(!expandedIntervalMin)}
                              >
                                {expandedIntervalMin ? '▼' : '▶'} {getAllTimeRangesForInterval(intervals, Math.min(...intervals.min_intervals.filter(i => i > 0)), true).length} периода
                              </button>
                              {expandedIntervalMin && (
                                <div className="time-ranges-list">
                                  {getAllTimeRangesForInterval(intervals, Math.min(...intervals.min_intervals.filter(i => i > 0)), true).map((range, i) => (
                                    <div key={i}>{range}</div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </span>
                      </span>
                    </div>
                    
                    {/* Максимальный интервал */}
                    <div className="stat-item">
                      <span className="stat-label">Максимальный:</span>
                      <span className="stat-value">
                        {Math.max(...intervals.max_intervals)} мин
                        <span className="stat-time">
                          {getAllTimeRangesForInterval(intervals, Math.max(...intervals.max_intervals), false).length === 1 ? (
                            <div>{getAllTimeRangesForInterval(intervals, Math.max(...intervals.max_intervals), false)[0]}</div>
                          ) : (
                            <>
                              <button 
                                className="expand-btn"
                                onClick={() => setExpandedIntervalMax(!expandedIntervalMax)}
                              >
                                {expandedIntervalMax ? '▼' : '▶'} {getAllTimeRangesForInterval(intervals, Math.max(...intervals.max_intervals), false).length} периода
                              </button>
                              {expandedIntervalMax && (
                                <div className="time-ranges-list">
                                  {getAllTimeRangesForInterval(intervals, Math.max(...intervals.max_intervals), false).map((range, i) => (
                                    <div key={i}>{range}</div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Вкладка: Карта */}
            {activeTab === 'map' && (
              <div className="tab-panel">
                <h3>Карта маршрута</h3>
                <RouteMap 
                  stops={stops || []}
                  selectedStop={stop}
                  onStopClick={onStopClick}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default StatsTabs
