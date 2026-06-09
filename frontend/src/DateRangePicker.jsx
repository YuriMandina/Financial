import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA = ['D','S','T','Q','Q','S','S'];

function toISO(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function fromISO(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDisplay(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function isSameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(d) {
  const n = new Date(d); n.setHours(0,0,0,0); return n;
}

// ─── Presets ────────────────────────────────────────────────────────────────

function getPresets() {
  const hoje = startOfDay(new Date());
  const y = hoje.getFullYear();
  const m = hoje.getMonth();
  const add = (d, days) => { const n = new Date(d); n.setDate(n.getDate() + days); return n; };
  return [
    { label: 'Hoje',            start: hoje,                  end: hoje },
    { label: 'Ontem',           start: add(hoje, -1),         end: add(hoje, -1) },
    { label: 'Últimos 7 dias',  start: add(hoje, -6),         end: hoje },
    { label: 'Últimos 30 dias', start: add(hoje, -29),        end: hoje },
    { label: 'Este mês',        start: new Date(y, m, 1),     end: new Date(y, m + 1, 0) },
    { label: 'Mês anterior',    start: new Date(y, m-1, 1),   end: new Date(y, m, 0) },
    { label: 'Este ano',        start: new Date(y, 0, 1),     end: new Date(y, 11, 31) },
    { label: 'Ano anterior',    start: new Date(y-1, 0, 1),   end: new Date(y-1, 11, 31) },
  ];
}

// ─── Month Calendar ──────────────────────────────────────────────────────────

function MonthCalendar({ year, month, startDate, endDate, hoverDate, onDayClick, onDayHover, selectingEnd }) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));

  const endForRange = selectingEnd && hoverDate ? hoverDate : endDate;

  const getRangeBounds = () => {
    if (!startDate || !endForRange) return { s: null, e: null };
    const a = startOfDay(startDate), b = startOfDay(endForRange);
    return a <= b ? { s: a, e: b } : { s: b, e: a };
  };

  const { s: rangeStart, e: rangeEnd } = getRangeBounds();

  const isInRange = (day) => {
    if (!day || !rangeStart || !rangeEnd) return false;
    const d = startOfDay(day);
    return d > rangeStart && d < rangeEnd;
  };

  return (
    <div className="select-none w-48">
      {/* Days of week */}
      <div className="grid grid-cols-7 mb-1">
        {DIAS_SEMANA.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-bold text-slate-500 py-1">{d}</div>
        ))}
      </div>
      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;

          const d = startOfDay(day);
          const isStart  = rangeStart && isSameDay(d, rangeStart);
          const isEnd    = rangeEnd   && isSameDay(d, rangeEnd);
          const inRange  = isInRange(day);
          const isToday  = isSameDay(d, new Date());
          const selected = isStart || isEnd;
          const hasRange = rangeStart && rangeEnd && !isSameDay(rangeStart, rangeEnd);

          return (
            <div
              key={day.toISOString()}
              className={`
                relative flex items-center justify-center h-7 cursor-pointer
                ${inRange ? 'bg-indigo-500/15' : ''}
                ${isStart && hasRange ? 'rounded-l-full bg-indigo-500/15' : ''}
                ${isEnd   && hasRange ? 'rounded-r-full bg-indigo-500/15' : ''}
              `}
              onClick={() => onDayClick(day)}
              onMouseEnter={() => onDayHover(day)}
            >
              <span className={`
                z-10 w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-medium transition-all
                ${selected ? 'bg-indigo-500 text-white font-bold shadow shadow-indigo-500/40' : ''}
                ${isToday && !selected ? 'ring-1 ring-indigo-400/70 text-indigo-300' : ''}
                ${!selected && !isToday ? 'text-slate-300 hover:bg-slate-700' : ''}
              `}>
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DateRangePicker({ startValue, endValue, onStartChange, onEndChange, disabled }) {
  const [open, setOpen]           = useState(false);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [hoverDate, setHoverDate] = useState(null);

  const today = new Date();
  const [leftYear,  setLeftYear]  = useState(today.getFullYear());
  const [leftMonth, setLeftMonth] = useState(today.getMonth() === 0 ? 0 : today.getMonth() - 1);

  const rightYear  = leftMonth === 11 ? leftYear + 1 : leftYear;
  const rightMonth = (leftMonth + 1) % 12;

  const startDate = fromISO(startValue);
  const endDate   = fromISO(endValue);

  const wrapperRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setSelectingEnd(false);
        setHoverDate(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleDayClick = useCallback((day) => {
    if (!selectingEnd) {
      onStartChange(toISO(day));
      onEndChange('');
      setSelectingEnd(true);
    } else {
      const s = startDate ? startOfDay(startDate) : null;
      const d = startOfDay(day);
      if (s && d < s) {
        onStartChange(toISO(day));
        onEndChange(startValue);
      } else {
        onEndChange(toISO(day));
      }
      setSelectingEnd(false);
      setHoverDate(null);
      setOpen(false);
    }
  }, [selectingEnd, startDate, startValue, onStartChange, onEndChange]);

  const applyPreset = (p) => {
    onStartChange(toISO(p.start));
    onEndChange(toISO(p.end));
    setLeftYear(p.start.getFullYear());
    setLeftMonth(p.start.getMonth());
    setSelectingEnd(false);
    setHoverDate(null);
    setOpen(false);
  };

  const prevMonth = () => {
    if (leftMonth === 0) { setLeftYear(y => y - 1); setLeftMonth(11); }
    else setLeftMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (leftMonth === 11) { setLeftYear(y => y + 1); setLeftMonth(0); }
    else setLeftMonth(m => m + 1);
  };

  const hasRange = startValue && endValue;
  const displayText = hasRange
    ? `${formatDisplay(startValue)}  →  ${formatDisplay(endValue)}`
    : startValue
      ? `${formatDisplay(startValue)}  →  …`
      : 'Selecionar período';

  const presets = getPresets();

  return (
    <div ref={wrapperRef} className="relative">
      {/* ── Trigger ── */}
      <button
        onClick={() => { if (!disabled) { setOpen(o => !o); } }}
        disabled={disabled}
        className={`
          flex items-center gap-2.5 h-10 px-4 rounded-xl border text-sm font-semibold transition-all whitespace-nowrap
          ${open
            ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-200 shadow-lg shadow-indigo-500/10'
            : 'bg-slate-900/60 border-slate-700/50 text-slate-300 hover:border-indigo-500/40 hover:text-white'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <CalendarDays size={15} className={open ? 'text-indigo-400' : 'text-slate-500'} />
        <span className={hasRange ? 'text-slate-200' : 'text-slate-500 font-normal'}>
          {displayText}
        </span>
        {hasRange && (
          <span
            className="ml-0.5 text-slate-500 hover:text-slate-300 transition-colors"
            onClick={(e) => { e.stopPropagation(); onStartChange(''); onEndChange(''); }}
          >
            <X size={12} />
          </span>
        )}
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div
          className="absolute z-[500] top-full mt-2 right-0 flex bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/70 overflow-hidden"
          style={{ animation: 'fadeIn 0.12s ease-out' }}
        >
          {/* Presets column */}
          <div className="w-36 flex-shrink-0 border-r border-slate-700/60 py-3 px-2 flex flex-col gap-0.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 px-2 pb-1.5">Atalhos</p>
            {presets.map(p => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className="text-left px-2 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:bg-indigo-500/15 hover:text-indigo-300 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar area */}
          <div className="p-4 flex flex-col gap-3">
            {/* Hint */}
            <div className="flex items-center justify-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${!selectingEnd ? 'bg-indigo-400 animate-pulse' : 'bg-slate-700'}`} />
              <span className="text-[11px] text-slate-400 font-medium">
                {selectingEnd ? 'Agora selecione a data final' : 'Selecione a data inicial'}
              </span>
              <span className={`w-1.5 h-1.5 rounded-full ${selectingEnd ? 'bg-indigo-400 animate-pulse' : 'bg-slate-700'}`} />
            </div>

            {/* Two months */}
            <div className="flex gap-5">
              {/* Left */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <button onClick={prevMonth} className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-slate-200">
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs font-bold text-slate-200 px-1">
                    {MESES[leftMonth]} {leftYear}
                  </span>
                  <div className="w-6" />
                </div>
                <MonthCalendar
                  year={leftYear} month={leftMonth}
                  startDate={startDate} endDate={endDate}
                  hoverDate={hoverDate} selectingEnd={selectingEnd}
                  onDayClick={handleDayClick} onDayHover={setHoverDate}
                />
              </div>

              {/* Divider */}
              <div className="w-px bg-slate-800 self-stretch my-1" />

              {/* Right */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="w-6" />
                  <span className="text-xs font-bold text-slate-200 px-1">
                    {MESES[rightMonth]} {rightYear}
                  </span>
                  <button onClick={nextMonth} className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-slate-200">
                    <ChevronRight size={14} />
                  </button>
                </div>
                <MonthCalendar
                  year={rightYear} month={rightMonth}
                  startDate={startDate} endDate={endDate}
                  hoverDate={hoverDate} selectingEnd={selectingEnd}
                  onDayClick={handleDayClick} onDayHover={setHoverDate}
                />
              </div>
            </div>

            {/* Footer */}
            {(startValue || endValue) && (
              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2.5 py-1 bg-indigo-500/15 text-indigo-300 rounded-lg font-bold">
                    {startValue ? formatDisplay(startValue) : '—'}
                  </span>
                  <ChevronRight size={12} className="text-slate-600" />
                  <span className="text-xs px-2.5 py-1 bg-indigo-500/15 text-indigo-300 rounded-lg font-bold">
                    {endValue ? formatDisplay(endValue) : '…'}
                  </span>
                </div>
                {hasRange && (
                  <button
                    onClick={() => { onStartChange(''); onEndChange(''); setSelectingEnd(false); }}
                    className="text-xs text-slate-600 hover:text-slate-400 transition-colors ml-3"
                  >
                    Limpar
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
