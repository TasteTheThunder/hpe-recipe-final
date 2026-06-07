import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import CatalogPage from './CatalogPage'
import ManagePage from './ManagePage'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/catalogs" element={<CatalogPage />} />
        <Route path="/manage" element={<ManagePage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
