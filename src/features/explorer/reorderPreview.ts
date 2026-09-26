import { t } from '../../ui/i18n';
/** A temporary visual layout: only the pointer-up handler commits the saved order. */
export function createReorderPreview(container: HTMLElement, source: string, ids: string[]) {
  const elements = new Map(Array.from(container.querySelectorAll<HTMLElement>('[data-reorder-id]')).map(el => [el.dataset.reorderId!, el]));
  const item = elements.get(source);
  if (!item) return null;
  const bounds = item.getBoundingClientRect();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const orders = new Map(Array.from(elements, ([id, el]) => [id, el.style.order]));
  const headers = new Map(Array.from(container.querySelectorAll<HTMLElement>('[data-reorder-group-header]')).map(el => [el.dataset.reorderGroupHeader!, el]));
  const headerStyles = new Map(Array.from(headers, ([name, el]) => [name, { order: el.style.order, display: el.style.display }]));
  const animations = new Map<HTMLElement, Animation>();
  // Hit-test stable slots rather than the animated cards, which move out from
  // under the pointer. Content coordinates keep these slots correct on scroll.
  const origin = container.getBoundingClientRect();
  const slots = ids.flatMap(id => {
    const el = elements.get(id);
    if (!el) return [];
    const r = el.getBoundingClientRect();
    return [{ id, left: r.left - origin.left + container.scrollLeft, top: r.top - origin.top + container.scrollTop, width: r.width, height: r.height }];
  });
  const ghost = item.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('data-reorder-id');
  ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.classList.add('dl-reorder-ghost');
  ghost.style.width = `${bounds.width}px`;
  ghost.style.height = `${bounds.height}px`;
  // cloneNode does not copy bitmap contents; preserve the actual histogram.
  const canvases = item.querySelectorAll('canvas');
  ghost.querySelectorAll('canvas').forEach((canvas, i) => { if (canvases[i]?.width && canvases[i]?.height) canvas.getContext('2d')?.drawImage(canvases[i], 0, 0); });
  const caption = document.createElement('div');
  caption.className = 'dl-reorder-caption'; ghost.append(caption);
  container.append(ghost);
  container.classList.add('is-reordering');
  item.classList.add('is-reorder-placeholder');
  const virtual = container.classList.contains('dl-virtual-variables');
  const insertion = virtual ? document.createElement('div') : null;
  if (insertion) {
    insertion.className = 'dl-reorder-insertion';
    insertion.setAttribute('aria-hidden', 'true');
    insertion.dataset.label = t('Soltar aquí');
    insertion.hidden = true;
    document.body.append(insertion);
  }
  let target: string | null | undefined;
  let finished = false;

  const animate = (el: HTMLElement, from: DOMRect, to: DOMRect) => {
    const dx = from.left - to.left, dy = from.top - to.top;
    if (reducedMotion || (Math.abs(dx) < .5 && Math.abs(dy) < .5)) return;
    const animation = el.animate([
      { transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' },
    ], { duration: 170, easing: 'cubic-bezier(.2,.8,.2,1)' });
    animations.set(el, animation);
  };

  return {
    bounds,
    targetAt(x: number, y: number): string | null {
      const area = container.getBoundingClientRect();
      if (x < area.left || x > area.right || y < area.top || y > area.bottom) return null;
      if (virtual) {
        let nearest: string | null = null, distance = Infinity;
        for (const card of container.querySelectorAll<HTMLElement>('[data-reorder-id]')) {
          const slot = card.getBoundingClientRect();
          const dx = Math.max(slot.left - x, 0, x - slot.right);
          const dy = Math.max(slot.top - y, 0, y - slot.bottom);
          const next = dx * dx + dy * dy;
          if (next < distance) { distance = next; nearest = card.dataset.reorderId ?? null; }
        }
        return nearest;
      }
      const localX = x - area.left + container.scrollLeft, localY = y - area.top + container.scrollTop;
      let nearest: string | null = null, distance = Infinity;
      for (const slot of slots) {
        const dx = Math.max(slot.left - localX, 0, localX - slot.left - slot.width);
        const dy = Math.max(slot.top - localY, 0, localY - slot.top - slot.height);
        const next = dx * dx + dy * dy;
        if (next < distance) { distance = next; nearest = slot.id; }
      }
      return nearest;
    },
    move(x: number, y: number, next: string | null) {
      ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (insertion) {
        const destinationCard = next && next !== source
          ? Array.from(container.querySelectorAll<HTMLElement>('[data-reorder-id]')).find(card => card.dataset.reorderId === next)
          : null;
        insertion.hidden = !destinationCard;
        if (destinationCard) {
          const area = container.getBoundingClientRect();
          const slot = destinationCard.getBoundingClientRect();
          // onMove places the source at the target's index in either direction.
          // Mark that slot, just above its card, independently of the ghost.
          const top = Math.max(area.top, slot.top - 6);
          const left = Math.max(area.left, slot.left);
          const right = Math.min(area.right, slot.right);
          insertion.hidden = slot.bottom <= area.top || top >= area.bottom || right <= left;
          insertion.style.left = `${left}px`;
          insertion.style.top = `${top}px`;
          insertion.style.width = `${Math.max(0, right - left)}px`;
        }
      }
      if (next === target) return;
      target = next;
      const destination = next ? ids.indexOf(next) : ids.indexOf(source);
      const projected = ids.filter(id => id !== source); projected.splice(destination, 0, source);
      caption.textContent = next ? t('Posición {position} de {count} · Esc cancela', {position: destination + 1, count: ids.length}) : t('Fuera del panel · Esc cancela');
      if (virtual) {
        // Virtual cards live in separate grid rows. CSS order cannot move a card
        // across those rows. The insertion line is the only destination cue.
        item.dataset.reorderLabel = next === source ? t('Posición original') : '';
        return;
      }
      item.dataset.reorderLabel = next ? t('Soltar aquí · {position}', {position: destination + 1}) : t('Posición original');
      const previous = new Map(Array.from(elements, ([id, el]) => [id, el.getBoundingClientRect()]));
      animations.forEach(animation => animation.cancel()); animations.clear();
      if (headers.size) {
        const groups = new Map<string, string[]>();
        const destinationGroup = elements.get(next ?? source)?.dataset.variableGroup ?? '';
        for (const id of projected) {
          const group = id === source ? destinationGroup : elements.get(id)?.dataset.variableGroup ?? '';
          groups.set(group, [...(groups.get(group) ?? []), id]);
        }
        // Collapsed groups have a header but no draggable cards.
        const names = [...groups.keys()];
        [...headers].forEach(([name, header], index) => {
          if (!groups.has(name) && header.getAttribute('aria-expanded') === 'false') names.splice(Math.min(index, names.length), 0, name);
        });
        let order = 0;
        headers.forEach((header, name) => { header.style.display = names.includes(name) ? '' : 'none'; });
        for (const name of names) {
          const header = headers.get(name); if (header) header.style.order = String(order++);
          for (const id of groups.get(name) ?? []) { const el = elements.get(id); if (el) el.style.order = String(order++); }
        }
      } else projected.forEach((id, index) => { const el = elements.get(id); if (el) el.style.order = String(index); });
      elements.forEach((el, id) => animate(el, previous.get(id)!, el.getBoundingClientRect()));
    },
    finish(land: boolean) {
      if (finished) return;
      finished = true;
      const floating = ghost.getBoundingClientRect();
      animations.forEach(animation => animation.cancel()); animations.clear();
      insertion?.remove();
      elements.forEach((el, id) => { el.style.order = orders.get(id) ?? ''; });
      headers.forEach((el, name) => { const original = headerStyles.get(name)!; el.style.order = original.order; el.style.display = original.display; });
      item.classList.remove('is-reorder-placeholder'); delete item.dataset.reorderLabel;
      container.classList.remove('is-reordering'); ghost.remove();
      // React commits the real order before the next frame. Settle the lifted
      // card into that final layout without retaining any temporary CSS order.
      if (land && !reducedMotion) requestAnimationFrame(() => {
        if (item.isConnected && !container.classList.contains('is-reordering')) animate(item, floating, item.getBoundingClientRect());
      });
    },
  };
}
