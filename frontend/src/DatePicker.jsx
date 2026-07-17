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

// ─── Month Calendar ──────────────────────────────────────────────────────────

function MonthCalendar({ year, month, selectedDate, onDayClick }) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));

  return (
    <div className="select-none w-56">
      <div className="grid grid-cols-7 mb-1">
        {DIAS_SEMANA.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-bold text-slate-500 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 gap-x-0.5">
        {days.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const d = startOfDay(day);
          const isSelected = selectedDate && isSameDay(d, startOfDay(selectedDate));
          const isToday = isSameDay(d, new Date());

          return (
            <div
              key={day.toISOString()}
              className={`relative flex items-center justify-center h-8 cursor-pointer rounded-full transition-all
                ${isSelected ? 'bg-indigo-500 text-white font-bold shadow-md shadow-indigo-500/40' : ''}
                ${isToday && !isSelected ? 'ring-1 ring-indigo-400/70 text-indigo-300' : ''}
                ${!isSelected && !isToday ? 'text-slate-300 hover:bg-slate-700' : ''}
              `}
              onClick={() => onDayClick(day)}
            >
              <span className="text-xs">{day.getDate()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DatePicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());

  const selectedDate = fromISO(value);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (open && value) {
      const d = fromISO(value);
      if (d) {
        setCurrentYear(d.getFullYear());
        setCurrentMonth(d.getMonth());
      }
    }
  }, [open, value]);

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleDayClick = useCallback((day) => {
    onChange(toISO(day));
    setOpen(false);
  }, [onChange]);

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentYear(y => y - 1); setCurrentMonth(11); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentYear(y => y + 1); setCurrentMonth(0); }
    else setCurrentMonth(m => m + 1);
  };

  const setHoje = () => {
    onChange(toISO(new Date()));
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        disabled={disabled}
        className={`
          w-full flex items-center justify-between h-11 px-4 rounded-xl border text-sm font-semibold transition-all
          ${open
            ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-200 shadow-lg shadow-indigo-500/10'
            : 'bg-slate-900/60 border-slate-700/50 text-slate-300 hover:border-indigo-500/40 hover:text-white'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <div className="flex items-center gap-2.5">
          <CalendarDays size={16} className={open ? 'text-indigo-400' : 'text-slate-500'} />
          <span className={value ? 'text-slate-200' : 'text-slate-500 font-normal'}>
            {value ? formatDisplay(value) : 'Selecione uma data'}
          </span>
        </div>
        {value && (
          <span
            className="text-slate-500 hover:text-slate-300 transition-colors"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
          >
            <X size={14} />
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute z-[500] bottom-full mb-2 right-0 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/70 overflow-hidden"
          style={{ animation: 'fadeIn 0.12s ease-out' }}
        >
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={prevMonth} className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-slate-200">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-bold text-slate-200 px-2 capitalize">
                {MESES[currentMonth]} {currentYear}
              </span>
              <button type="button" onClick={nextMonth} className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-slate-200">
                <ChevronRight size={16} />
              </button>
            </div>
            
            <MonthCalendar
              year={currentYear} month={currentMonth}
              selectedDate={selectedDate}
              onDayClick={handleDayClick}
            />

            <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors font-semibold"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={setHoje}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-bold"
              >
                Hoje
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
