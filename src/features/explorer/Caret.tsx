export function Caret({ direction = 'down' }: { direction?: 'down' | 'right' }) {
  return <svg className={`dl-caret dl-caret-${direction}`} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
    <path d="m2.5 4.5 3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
