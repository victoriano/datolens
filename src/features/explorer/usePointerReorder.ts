import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createReorderPreview } from './reorderPreview';

/** Internal reordering uses pointer capture: Tauri keeps its native Finder drop handler. */
export function usePointerReorder(ids: string[], onMove: (source: string, target: string) => void, options: { preview?: boolean } = {}) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ ids, onMove }); latest.current = { ids, onMove };
  const cleanup = useRef<(() => void) | null>(null);
  const [drag, setDrag] = useState<{ source: string; target: string | null } | null>(null);
  useEffect(() => () => cleanup.current?.(), [JSON.stringify(ids)]);

  const start = (event: ReactPointerEvent<HTMLElement>, source: string) => {
    if (event.button !== 0 || !root.current) return;
    event.preventDefault(); event.stopPropagation(); cleanup.current?.();
    const handle = event.currentTarget, container = root.current, pointerId = event.pointerId;
    handle.focus(); handle.setPointerCapture(pointerId);
    const startX = event.clientX, startY = event.clientY;
    let x = startX, y = startY, active = false, target: string | null = null, frame = 0;
    let preview: ReturnType<typeof createReorderPreview> = null;
    const hit = () => {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-reorder-id]');
      const next = preview ? preview.targetAt(x, y) : element && container.contains(element) ? element.dataset.reorderId ?? null : null;
      preview?.move(x - startX + preview.bounds.left, y - startY + preview.bounds.top, next);
      if (next !== target) { target = next; setDrag({ source, target }); }
    };
    const scroll = () => {
      if (active) {
        const bounds = container.getBoundingClientRect();
        const speed = (position: number, min: number, max: number) => position < min || position > max ? 0 : position < min + 36 ? -10 : position > max - 36 ? 10 : 0;
        container.scrollBy(speed(x, bounds.left, bounds.right), speed(y, bounds.top, bounds.bottom));
        hit();
      }
      frame = requestAnimationFrame(scroll);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      x = ev.clientX; y = ev.clientY;
      if (!active && Math.hypot(x - startX, y - startY) >= 4) {
        active = true;
        if (options.preview) preview = createReorderPreview(container, source, latest.current.ids);
        setDrag({ source, target: null });
      }
      if (active) hit();
    };
    const finish = (land = false) => {
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', drop);
      handle.removeEventListener('pointercancel', cancel);
      handle.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      preview?.finish(land);
      cleanup.current = null; setDrag(null);
    };
    const cancel = () => finish();
    const drop = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      x = ev.clientX; y = ev.clientY; if (active) hit();
      const destination = target; finish(active && destination !== null);
      if (active && destination && destination !== source) latest.current.onMove(source, destination);
    };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); cancel(); } };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', drop);
    handle.addEventListener('pointercancel', cancel);
    handle.addEventListener('lostpointercapture', cancel);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    cleanup.current = () => finish(); frame = requestAnimationFrame(scroll);
  };
  return {
    root, drag,
    className: (id: string) => options.preview ? '' : drag?.source === id ? 'is-dragging' : drag?.target === id ? 'is-drop-target' : '',
    handle: (id: string) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => start(event, id),
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        const delta = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
        if (delta === undefined || drag) return;
        event.preventDefault(); event.stopPropagation();
        const target = latest.current.ids[latest.current.ids.indexOf(id) + delta];
        if (target) latest.current.onMove(id, target);
      },
    }),
  };
}
