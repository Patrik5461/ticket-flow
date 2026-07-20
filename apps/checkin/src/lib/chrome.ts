import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

const BG = '#09090b'

/**
 * Light-on-dark status bar. iOS resets the status bar on resume and the MLKit
 * scanner can leave it altered, so this is re-asserted on every app resume and
 * on scanner exit. Safe to call anywhere (no-op off-device).
 */
export async function ensureDarkStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  // Style.Dark = light text for dark backgrounds.
  try {
    await StatusBar.setStyle({ style: Style.Dark })
  } catch {
    /* not fatal */
  }
  try {
    await StatusBar.setBackgroundColor({ color: BG })
  } catch {
    /* Android-only; iOS throws — ignore */
  }
}

/**
 * Fully restore the app's dark chrome after the scanner. The MLKit scanner runs
 * the camera behind a transparent webview (we add `.scanning`; the plugin also
 * makes the native view transparent). On exit we must reverse ALL of that or the
 * safe-area regions show white. Idempotent — safe to call on every exit path.
 */
export function restoreDarkChrome(): void {
  document.documentElement.classList.remove('scanning')
  document.body.classList.remove('barcode-scanner-active')
  // Force an opaque dark background back (beats any lingering transparency);
  // the `.scanning` rules use !important so they still win while scanning.
  document.documentElement.style.backgroundColor = BG
  document.body.style.backgroundColor = BG
  void ensureDarkStatusBar()
}
