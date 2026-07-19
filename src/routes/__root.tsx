import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import appCss from '../styles.css?url'
import { CookieConsent } from '../components/CookieConsent'
import { SupportChat } from '../components/SupportChat'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#09090b' },
      { title: 'Ticketio — Vstupenky bez starostí' },
      {
        name: 'description',
        content:
          'Moderná slovenská platforma na predaj vstupeniek. Transparentný cenník, priebežný payout, mobilné odbavenie.',
      },
      { property: 'og:title', content: 'Ticketio — Vstupenky bez starostí' },
      {
        property: 'og:description',
        content: 'Transparentný cenník, priebežný payout, moderné odbavenie.',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <head>
        {/* Capture early client errors so hydration failures are diagnosable
            on mobile via remote Safari inspector (window.__ticketioErr). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){function r(m){try{window.__ticketioErr=(window.__ticketioErr||[]).concat(String(m)).slice(-5);console.error('[ticketio:client]',m);}catch(e){}}window.addEventListener('error',function(e){r((e&&e.message)||'error');});window.addEventListener('unhandledrejection',function(e){r((e&&e.reason&&(e.reason.message||e.reason))||'rejection');});})();",
          }}
        />
        {/* Runtime polyfills for older mobile Safari (iOS 13–15). These APIs are
            emitted by vendor chunks (TanStack server-fn runtime uses Object.hasOwn;
            main chunk uses String.prototype.replaceAll) and would throw before
            hydration. Must run before the module bundle — hence a classic inline
            script, not a module import. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{if(!Object.hasOwn){Object.defineProperty(Object,'hasOwn',{value:function(o,p){return Object.prototype.hasOwnProperty.call(o,p);},configurable:true,writable:true});}if(!String.prototype.replaceAll){String.prototype.replaceAll=function(s,r){return Object.prototype.toString.call(s)==='[object RegExp]'?this.replace(s,r):this.split(s).join(r);};}if(!Array.prototype.at){Object.defineProperty(Array.prototype,'at',{value:function(n){n=Math.trunc(n)||0;if(n<0)n+=this.length;return n<0||n>=this.length?undefined:this[n];},configurable:true,writable:true});}}catch(e){}})();",
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.classList.add('light');}}catch(e){}})();",
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <SupportChat />
        <CookieConsent />
        <TanStackDevtools
          config={{ position: 'bottom-right' }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
