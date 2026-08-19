import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { formatAppVersion } from '@/lib/appVersion'
import '@/index.css'

document.title = `Transitix ${formatAppVersion()}`

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
