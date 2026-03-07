import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  componentDidCatch(error) {
    this.setState({ error })
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'red', fontFamily: 'monospace', fontSize: 13 }}>
          <b>Ошибка приложения:</b>
          <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{this.state.error.toString()}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

const hideLoadingScreen = () => {
  const loadingScreen = document.getElementById('loading-screen')
  if (loadingScreen) {
    loadingScreen.style.opacity = '0'
    loadingScreen.style.transition = 'opacity 0.3s'
    setTimeout(() => { loadingScreen.remove() }, 300)
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)

// Убираем loading screen — с запасом времени для рендера
setTimeout(hideLoadingScreen, 500)
// Страховка: если через 3 секунды ещё виден — убрать принудительно
setTimeout(hideLoadingScreen, 3000)
