import React from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { createTheme } from '@mui/material/styles'
import { deDE, enUS, esES, frFR } from '@mui/material/locale'
import App from './App'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { SessionManager } from './auth/SessionManager'
import { WithQueryClient } from './lib/queryClient'
import { ThemeModeProvider, createAppTheme, useThemeMode } from './config/ThemeContext'
import { TenantProvider, useTenant } from './tenant/TenantContext'
import { KanapDialogProvider } from './components/design'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './i18n'
import { useLocale } from './i18n/useLocale'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import './styles/ag-grid-overrides.css'
import './styles/print.css'
import { installCsvExportGuard } from './utils/csvExportGuard'

// Every grid's CSV export neutralises formula-like headers and cells.
installCsvExportGuard()

const MUI_LOCALES = {
  en: enUS,
  fr: frFR,
  de: deDE,
  es: esES,
} as const

function AppShell() {
  const { resolvedMode } = useThemeMode()
  const { primaryColorLight, primaryColorDark } = useTenant()
  const locale = useLocale()
  const theme = React.useMemo(
    () => createTheme(
      createAppTheme(resolvedMode, { light: primaryColorLight, dark: primaryColorDark }),
      MUI_LOCALES[locale] ?? enUS,
    ),
    [resolvedMode, primaryColorDark, primaryColorLight, locale],
  )

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Router updates render synchronously, as in v6: the leave guards see the page state of the latest navigation. */}
      <BrowserRouter useTransitions={false}>
        <WithQueryClient>
          <AuthProvider>
            <SessionManager>
              <KanapDialogProvider>
                {/* Inside the theme and i18n providers so the fallback renders styled and
                    translated, and around <App /> so a route-level crash or a failed chunk
                    import shows a message instead of a blank page. */}
                <AppErrorBoundary>
                  <App />
                </AppErrorBoundary>
              </KanapDialogProvider>
            </SessionManager>
          </AuthProvider>
        </WithQueryClient>
      </BrowserRouter>
    </ThemeProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeModeProvider>
      <TenantProvider>
        <AppShell />
      </TenantProvider>
    </ThemeModeProvider>
  </React.StrictMode>
)
