import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { formatAppVersion } from '@/lib/appVersion'
import { companionAppTitle } from '@/lib/appProfile'
import '@/index.css'

// The companion carries the customer's name, not ours — including in the tab.
document.title = `${companionAppTitle()} ${formatAppVersion()}`

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
