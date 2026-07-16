/**
 * Ticketio embed widget. Usage:
 *   <script src="https://ticketio.sk/widget.js" data-event="event-slug" async></script>
 *
 * Injects an auto-resizing iframe with the event's ticket storefront right after
 * the script tag. Buying opens the full Ticketio checkout in a new tab.
 */
(function () {
  var script = document.currentScript
  if (!script) return
  var slug = script.getAttribute('data-event')
  if (!slug) {
    // eslint-disable-next-line no-console
    console.error('[ticketio] widget: missing data-event attribute')
    return
  }

  var base = new URL(script.src).origin
  var iframe = document.createElement('iframe')
  iframe.src = base + '/e/' + encodeURIComponent(slug) + '/embed'
  iframe.title = 'Ticketio — predaj vstupeniek'
  iframe.setAttribute('scrolling', 'no')
  iframe.style.width = '100%'
  iframe.style.border = '0'
  iframe.style.overflow = 'hidden'
  iframe.style.minHeight = '260px'
  script.parentNode.insertBefore(iframe, script.nextSibling)

  window.addEventListener('message', function (event) {
    if (event.source !== iframe.contentWindow) return
    var data = event.data
    if (
      data &&
      data.type === 'ticketio-embed-resize' &&
      typeof data.height === 'number' &&
      data.height > 0
    ) {
      iframe.style.height = data.height + 'px'
    }
  })
})()
