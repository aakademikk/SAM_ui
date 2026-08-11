'use client';

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  EyeOff,
  GripVertical,
  MoreHorizontal,
  RefreshCw,
  Square,
  RectangleHorizontal,
  RectangleVertical,
  Maximize2,
} from 'lucide-react';

import type { LoadState, WidgetKind, WidgetSize } from '@/types/dashboard';
import { WIDGET_SIZE_LABELS } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { errorState } from '@/lib/personalityEngine';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import {
  ErrorState,
  RelativeTime,
  StatusDot,
  TONE_COLOR,
  type ToneName,
} from '@/components/ui/Indicators';
import { WidgetSkeleton } from '@/components/ui/Skeleton';

const SIZE_ICONS: Record<WidgetSize, typeof Square> = {
  sm: Square,
  'md-wide': RectangleHorizontal,
  'md-tall': RectangleVertical,
  lg: Maximize2,
};

const SIZE_ORDER: WidgetSize[] = ['sm', 'md-wide', 'md-tall', 'lg'];

export interface WidgetFrameProps {
  id: WidgetKind;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  tone?: ToneName;
  size: WidgetSize;
  status: LoadState;
  error?: string | null;
  updatedAt?: number | null;
  index?: number;
  /** Skeleton shape shown while the first payload is in flight. */
  skeletonVariant?: 'list' | 'chart' | 'grid' | 'terminal';
  onRefresh?: () => void;
  /** Listeners from `useSortable`, spread onto the grip. */
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
  isOverlay?: boolean;
  headerRight?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function WidgetFrame({
  id,
  title,
  subtitle,
  icon,
  tone = 'accent',
  size,
  status,
  error,
  updatedAt,
  index = 0,
  skeletonVariant = 'list',
  onRefresh,
  dragHandleProps,
  isDragging = false,
  isOverlay = false,
  headerRight,
  footer,
  children,
  className,
  style,
}: WidgetFrameProps) {
  const setWidgetSize = useUserPreferencesStore((s) => s.setWidgetSize);
  const setWidgetVisible = useUserPreferencesStore((s) => s.setWidgetVisible);
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);
  const reducedMotion = useUserPreferencesStore((s) => s.reducedMotion);

  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* --- Pointer spotlight -------------------------------------------------- */
  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (reducedMotion || !cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      // Written straight to CSS vars — no React state, no re-render per frame.
      cardRef.current.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width) * 100}%`);
      cardRef.current.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height) * 100}%`);
    },
    [reducedMotion],
  );

  /* --- Menu dismissal ----------------------------------------------------- */
  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const accent = TONE_COLOR[tone];
  const isLoading = status === 'loading';
  const isError = status === 'error';

  return (
    <motion.section
      ref={cardRef}
      layout={!reducedMotion && !isOverlay}
      layoutId={isOverlay ? undefined : `widget-${id}`}
      onPointerMove={handlePointerMove}
      initial={isOverlay ? false : { opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: reducedMotion ? 0 : 0.42,
        delay: reducedMotion || isOverlay ? 0 : Math.min(index * 0.045, 0.36),
        ease: [0.16, 1, 0.3, 1],
        layout: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
      }}
      className={cn(
        'group/widget glass brackets relative flex min-h-0 flex-col overflow-hidden rounded-md',
        'transition-shadow duration-300',
        isDragging && 'opacity-35',
        isOverlay && 'shadow-[0_40px_90px_-20px_rgba(0,0,0,0.85)] ring-1 ring-[var(--sam-accent)]/45',
        className,
      )}
      style={{ ...style, ['--widget-accent' as string]: accent }}
      aria-busy={isLoading}
    >
      {/* Hover spotlight — follows the pointer across the glass. */}
      {!reducedMotion && (
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/widget:opacity-100"
          style={{
            background: `radial-gradient(420px circle at var(--mx, 50%) var(--my, 0%), color-mix(in oklab, ${accent} 13%, transparent), transparent 68%)`,
          }}
        />
      )}

      {/* Animated gradient border on hover. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md opacity-0 transition-opacity duration-400 group-hover/widget:opacity-100"
        style={{
          padding: 1,
          background: `linear-gradient(135deg, ${accent}00 0%, ${accent}b0 28%, var(--sam-accent-2) 52%, ${accent}00 82%)`,
          WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
        animate={
          reducedMotion
            ? undefined
            : { backgroundPositionX: ['0%', '160%'], filter: ['saturate(1)', 'saturate(1.35)', 'saturate(1)'] }
        }
        transition={{ duration: 4.5, repeat: Infinity, ease: 'linear' }}
      />

      {/* Top accent hairline. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}90, transparent)` }}
      />

      {/* ---------------------------------------------------------------- */}
      {/* Header                                                            */}
      {/* ---------------------------------------------------------------- */}
      <header className="relative flex shrink-0 items-center gap-2 border-b border-void-500/45 px-3 py-2.5">
        {/* Icon and grip share one slot — a 1-column widget has no header width
            to spare for a permanently reserved handle. */}
        <span className="relative size-[15px] shrink-0">
          <span
            className="absolute inset-0 flex items-center justify-center transition-opacity group-hover/widget:opacity-0"
            style={{ color: accent }}
          >
            {icon}
          </span>
          <button
            type="button"
            {...dragHandleProps}
            aria-label={`Reorder ${title}`}
            className={cn(
              'drag-none absolute inset-0 flex cursor-grab touch-none items-center justify-center',
              'rounded-[3px] text-dim-200 opacity-0 transition',
              'hover:text-slate-200 focus-visible:opacity-100 group-hover/widget:opacity-100',
              'active:cursor-grabbing',
            )}
          >
            <GripVertical size={13} strokeWidth={2} />
          </button>
        </span>

        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="truncate font-mono text-[11px] font-semibold tracking-[0.13em] text-slate-200 uppercase">
            {title}
          </h2>
          {/* Subtitles only earn their space on two-column footprints. */}
          {subtitle && (size === 'md-wide' || size === 'lg') && (
            <span className="truncate font-mono text-[9.5px] tracking-wider text-slate-500 uppercase">
              {subtitle}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {headerRight}

          {isError ? (
            <StatusDot tone="critical" pulse title="Feed error" />
          ) : isLoading ? (
            <StatusDot tone="warning" pulse title="Fetching" />
          ) : (
            <StatusDot tone="success" title="Live" />
          )}

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              aria-label={`Refresh ${title}`}
              className="rounded-[3px] p-1 text-dim-200 opacity-0 transition hover:bg-white/5 hover:text-slate-300 focus-visible:opacity-100 group-hover/widget:opacity-100"
            >
              <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
            </button>
          )}

          {/* ---- Ellipsis menu ---- */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={`${title} options`}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className={cn(
                'rounded-[3px] p-1 text-dim-200 transition hover:bg-white/5 hover:text-slate-300',
                menuOpen ? 'bg-white/8 text-slate-200 opacity-100' : 'opacity-0 group-hover/widget:opacity-100',
              )}
            >
              <MoreHorizontal size={13} />
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, scale: 0.94, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="glass-strong absolute top-full right-0 z-50 mt-1.5 w-48 origin-top-right overflow-hidden rounded-[5px] py-1 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)]"
                >
                  <p className="label px-2.5 py-1.5">Widget size</p>

                  {SIZE_ORDER.map((option) => {
                    const Icon = SIZE_ICONS[option];
                    const active = option === size;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => {
                          setWidgetSize(id, option);
                          setMenuOpen(false);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[11.5px] transition-colors',
                          active ? 'text-slate-100' : 'text-slate-400 hover:bg-white/6 hover:text-slate-200',
                        )}
                      >
                        <Icon size={12} style={{ color: active ? accent : undefined }} />
                        <span className="flex-1">{WIDGET_SIZE_LABELS[option]}</span>
                        {active && <Check size={12} style={{ color: accent }} />}
                      </button>
                    );
                  })}

                  <div className="my-1 h-px bg-void-500/60" />

                  {onRefresh && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onRefresh();
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[11.5px] text-slate-400 transition-colors hover:bg-white/6 hover:text-slate-200"
                    >
                      <RefreshCw size={12} />
                      Refresh now
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setWidgetVisible(id, false);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[11.5px] text-slate-400 transition-colors hover:bg-alarm-500/12 hover:text-alarm-300"
                  >
                    <EyeOff size={12} />
                    Hide widget
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Body                                                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isError ? (
          <ErrorState
            message={`${errorState(title.toLowerCase(), id, sarcasm)}${error ? ` (${error})` : ''}`}
            onRetry={onRefresh}
          />
        ) : isLoading ? (
          <div className="h-full p-3">
            <WidgetSkeleton index={index} variant={skeletonVariant} rows={4} />
          </div>
        ) : (
          children
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Footer                                                            */}
      {/* ---------------------------------------------------------------- */}
      {(footer || updatedAt !== undefined) && (
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-void-500/45 px-3 py-1.5">
          <div className="min-w-0 flex-1 truncate">{footer}</div>
          {updatedAt !== undefined && (
            <RelativeTime
              value={updatedAt}
              prefix="updated "
              className="shrink-0 font-mono text-[9px] tracking-wider text-slate-600 lowercase"
            />
          )}
        </footer>
      )}
    </motion.section>
  );
}
