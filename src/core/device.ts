/** iPhone or iPad (an iPad's Safari says Macintosh, but has touch) */
export function isAppleMobile(
  ua = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0
): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}
