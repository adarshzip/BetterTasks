import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Panel } from '@/ui/Panel'
import { ErrorBoundary } from '@/ui/ErrorBoundary'
import { detectTheme, watchTheme } from '@/ui/theme'

/**
 * Side panel entry point.
 *
 * This is an ordinary extension page that the browser hosts beside the tab, so
 * there is no host page to fight: no injected DOM, no stacking contexts, no
 * anchor detection, and nothing that breaks when Calendar is redesigned.
 */

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root')

// Clear the boot placeholder from index.html now that the module is running.
container.innerHTML = ''

const root = createRoot(container)

function render(): void {
  root.render(
    <StrictMode>
      <ErrorBoundary onReset={render}>
        <Panel theme={detectTheme()} />
      </ErrorBoundary>
    </StrictMode>,
  )
}

render()
watchTheme(render)
