/**
 * The one limitation of offline mode, in one place: devices without a network
 * cannot see each other's admissions, so the same ticket can be let in on each
 * of them until they sync.
 *
 * Shown once after the first download of an event, and on demand from the (i)
 * next to the OFFLINE badge in the scanner.
 */
export const OFFLINE_MULTI_DEVICE_TEXT =
  'Ak na tomto podujatí skenuje viac zariadení bez internetu, môže sa tá istá ' +
  'vstupenka odbaviť na každom z nich. Duplicity sa odhalia až po pripojení.'

export const OFFLINE_MULTI_DEVICE_TIP =
  'Odporúčanie: rozdeľte vstupy medzi zariadenia, alebo majte aspoň jedno ' +
  'zariadenie online.'

export function OfflineNoticeModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-title">Offline režim</div>
        <p className="modal-text">{OFFLINE_MULTI_DEVICE_TEXT}</p>
        <p className="modal-text tip">{OFFLINE_MULTI_DEVICE_TIP}</p>
        <button className="btn-primary modal-btn" onClick={onClose}>
          Rozumiem
        </button>
      </div>
    </div>
  )
}
