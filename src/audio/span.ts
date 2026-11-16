let token = 0
/** The element last played, so it can be stopped after its React ref is gone (unmount). */
let last: HTMLMediaElement | null = null

/** Play [start, end] seconds of a media element; resolves when done or superseded/stopped. */
export function playSpan(el: HTMLMediaElement, start: number, end: number, rate = 1, onTime?: (t: number) => void): Promise<void> {
  const mine = ++token
  last = el
  el.pause()
  el.currentTime = Math.max(0, start)
  el.playbackRate = rate
  el.preservesPitch = true
  return el.play().then(
    () =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (mine !== token || el.paused || el.currentTime >= end) {
            if (mine === token) el.pause()
            onTime?.(NaN)
            resolve()
          } else {
            onTime?.(el.currentTime)
            requestAnimationFrame(check)
          }
        }
        check()
      }),
  )
}

/** Stop the span being played on `el`, or on whichever element played last when `el` is not given. */
export function stopSpan(el?: HTMLMediaElement | null) {
  token++
  ;(el ?? last)?.pause()
}
