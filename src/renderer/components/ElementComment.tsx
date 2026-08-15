import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { useFocusTrap } from '../a11y/useFocusTrap'

/**
 * The note you attach to an element you clicked in the preview.
 *
 * Point at the thing that is wrong, say what you want, and it goes to Claude as a
 * message with the exact selector attached — so it does not have to guess which button
 * you meant.
 */
export function ElementComment(): JSX.Element | null {
  const { pickedElement, clearPickedElement, sendElementComment } = useStore()
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useFocusTrap(dialog, pickedElement !== null, box)

  useEffect(() => {
    if (pickedElement) {
      setComment('')
      // Focus after paint, or the textarea is not in the document yet.
      requestAnimationFrame(() => box.current?.focus())
    }
  }, [pickedElement])

  useEffect(() => {
    if (!pickedElement) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') clearPickedElement()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickedElement, clearPickedElement])

  if (!pickedElement) return null

  const send = async (): Promise<void> => {
    if (!comment.trim() || sending) return
    setSending(true)
    await sendElementComment(comment)
    setSending(false)
  }

  return (
    <div className="overlay comment-overlay" onMouseDown={clearPickedElement}>
      <div
        ref={dialog}
        className="comment-box"
        role="dialog"
        aria-modal="true"
        aria-label="Comment on element"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="comment-header">
          <span className="comment-tag">&lt;{pickedElement.tag}&gt;</span>
          <code className="comment-selector" title={pickedElement.selector}>
            {pickedElement.selector}
          </code>
          <button className="icon-only" aria-label="Cancel" onClick={clearPickedElement}>
            ×
          </button>
        </div>

        {pickedElement.text && <p className="comment-text">“{pickedElement.text}”</p>}

        <textarea
          ref={box}
          value={comment}
          placeholder="What should change here? ⌘Enter to send to Claude"
          aria-label="Your comment"
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
          }}
        />

        <div className="comment-actions">
          <span className="comment-hint">Sent to the Claude terminal with this selector attached.</span>
          <button className="labelled" onClick={clearPickedElement}>
            Cancel
          </button>
          <button className="primary" disabled={!comment.trim() || sending} onClick={() => void send()}>
            {sending ? 'Sending…' : 'Send to Claude'}
          </button>
        </div>
      </div>
    </div>
  )
}
