import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Ticketio Scan — native check-in app.
 *
 * Scan-only: the app never renders admin, revenue or event-management UI. It
 * authenticates an organizer member (owner / admin / checkin role) and exposes
 * only the event list + scanner. See README for the security rationale.
 */
const config: CapacitorConfig = {
  appId: 'sk.ticketio.scan',
  appName: 'Ticketio Scan',
  webDir: 'dist',
  // Dark shell (zinc-950) so there's no white flash before React mounts.
  backgroundColor: '#09090b',
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      launchAutoHide: true,
      backgroundColor: '#09090b',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashImmersive: true,
    },
    // The MLKit barcode scanner runs the camera natively behind a transparent
    // webview; the fullscreen colour response is drawn as HTML on top. No
    // config needed here — camera permission strings live in the native
    // projects (see README).
  },
  ios: {
    // 'never' — the webview paints edge-to-edge and the layout clears the
    // notch / home indicator in CSS (env(safe-area-inset-*), see theme.css).
    // With 'always' WKWebView insets its scroll view, and the exposed strip at
    // the top is painted by the NATIVE webview background, not by our HTML —
    // that strip is the white bar. Never inset natively; inset in CSS.
    contentInset: 'never',
    backgroundColor: '#09090b',
  },
  android: {
    backgroundColor: '#09090b',
  },
}

export default config
