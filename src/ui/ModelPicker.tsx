import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './model-picker.css';

export interface ModelOption {
  id: string;
  provider: 'jev' | 'gemini';
}

interface ModelPickerProps {
  label: string;
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

interface PopupPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const providerName = (provider: ModelOption['provider']) => provider === 'jev' ? 'Jev' : 'Gemini';
const geminiIcon = new URL('./assets/gemini.png', import.meta.url).href;
const jevIcon = new URL('./assets/typesafe-jev.png', import.meta.url).href;
const providerIcon = (provider: ModelOption['provider']) => provider === 'jev' ? jevIcon : geminiIcon;

function ProviderMark({ provider }: { provider: ModelOption['provider'] }) {
  return <span className={`dl-model-picker-mark dl-model-picker-mark-${provider}`} aria-hidden="true">
    <img src={providerIcon(provider)} alt="" draggable={false} />
  </span>;
}

export function ModelPicker({ label, value, options, onChange, disabled = false }: ModelPickerProps) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const [active, setActive] = useState(0);
  const selected = options.find(option => option.id === value) ?? {
    id: value,
    provider: value.startsWith('jev-') ? 'jev' as const : 'gemini' as const,
  };
  const items = options.some(option => option.id === value) ? options : [selected, ...options];

  const close = (restoreFocus = false) => {
    setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  };

  const open = () => {
    if (disabled || !trigger.current || !items.length) return;
    const rect = trigger.current.getBoundingClientRect();
    const dialogRect = trigger.current.closest('dialog')?.getBoundingClientRect();
    const visibleTop = Math.max(8, (dialogRect?.top ?? 0) + 8);
    const visibleBottom = Math.min(window.innerHeight - 8, (dialogRect?.bottom ?? window.innerHeight) - 8);
    const width = Math.min(Math.max(rect.width, 224), window.innerWidth - 16);
    const desiredHeight = Math.min(280, items.length * 48 + 12);
    const spaceAbove = rect.top - visibleTop;
    const spaceBelow = visibleBottom - rect.bottom;
    const above = spaceBelow < 144 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(48, Math.min(desiredHeight, (above ? spaceAbove : spaceBelow) - 6));
    const top = above ? rect.top - maxHeight - 6 : rect.bottom + 6;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setActive(Math.max(0, items.findIndex(option => option.id === value)));
    setPosition({ top, left, width, maxHeight });
  };

  const choose = (option: ModelOption) => {
    if (option.id !== value) onChange(option.id);
    close(true);
  };

  useEffect(() => {
    if (!position) return;
    popup.current?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popup.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', scroll);
    };
  }, [position]);

  useEffect(() => {
    if (disabled && position) setPosition(null);
  }, [disabled, position]);

  useEffect(() => {
    if (position) popup.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, position]);

  const host = trigger.current?.closest('dialog') ?? document.body;
  return <div className="dl-model-picker">
    <span className="dl-model-picker-label">{label}</span>
    <button
      ref={trigger}
      type="button"
      className="dl-model-picker-trigger"
      title={selected.id}
      aria-label={label + ': ' + selected.id}
      aria-haspopup="listbox"
      aria-expanded={!!position}
      aria-controls={position ? listId : undefined}
      disabled={disabled}
      onClick={() => position ? close() : open()}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          open();
        }
      }}
    >
      <ProviderMark provider={selected.provider} />
      <span className="dl-model-picker-copy"><strong>{selected.id}</strong><small>{providerName(selected.provider)}</small></span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {position && createPortal(
      <div
        ref={popup}
        id={listId}
        className="dl-model-picker-popup"
        role="listbox"
        aria-label={label}
        aria-activedescendant={listId + '-' + active}
        tabIndex={-1}
        style={position}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
          else if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(items.length - 1, index + 1)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
          else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
          else if (event.key === 'End') { event.preventDefault(); setActive(items.length - 1); }
          else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(items[active]); }
          else if (event.key === 'Tab') close();
        }}
      >
        {items.map((option, index) => <div
          key={option.id}
          id={listId + '-' + index}
          role="option"
          aria-selected={option.id === value}
          data-active={index === active}
          className="dl-model-picker-option"
          onMouseEnter={() => setActive(index)}
          onMouseDown={event => event.preventDefault()}
          onClick={() => choose(option)}
        >
          <ProviderMark provider={option.provider} />
          <span className="dl-model-picker-option-copy"><strong>{option.id}</strong><small>{providerName(option.provider)}</small></span>
          {option.id === value && <span className="dl-model-picker-check" aria-hidden="true">✓</span>}
        </div>)}
      </div>,
      host,
    )}
  </div>;
}
