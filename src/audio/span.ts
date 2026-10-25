let token = 0

/** Play [start, end] seconds of a media element; resolves when done or superseded/stopped. */
export function playSpan(el: HTMLMediaElement, start: number, end: number, rate = 1, onTime?: (t: number) => void): Promise<void> {
  const mine = ++token
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

export function stopSpan(el?: HTMLMediaElement | null) {
  token++
  el?.pause()
}
