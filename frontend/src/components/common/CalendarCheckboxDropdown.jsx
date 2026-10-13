import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Calendar, ChevronDown, Check, X } from 'lucide-react';

const WEEKDAYS = [
  { key: 'D', label: 'Dom', index: 6 },
  { key: 'S', label: 'Seg', index: 0 },
  { key: 'T', label: 'Ter', index: 1 },
  { key: 'Q', label: 'Qua', index: 2 },
  { key: 'Q', label: 'Qui', index: 3 },
  { key: 'S', label: 'Sex', index: 4 },
  { key: 'S', label: 'Sáb', index: 5 }
];

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

/**
 * Dropdown com Calendário Mensal e Checkboxes por Data.
 * 
 * Props:
 * - year: number
 * - month: number (1-12)
 * - selectedDays: number[]
 * - onChange: (days: number[]) => void
 * - holidays?: Record<number, string>
 * - sundays?: number[]
 * - disabledDays?: number[]
 * - className?: string
 * - placeholder?: string
 */
export default function CalendarCheckboxDropdown({
  year,
  month,
  selectedDays = [],
  onChange,
  holidays = {},
  sundays = [],
  disabledDays = [],
  className = '',
  placeholder = 'Selecione os dias...'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Fecha ao clicar fora
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const totalDays = useMemo(() => {
    return new Date(year, month, 0).getDate();
  }, [year, month]);

  const firstDayOfWeek = useMemo(() => {
    return new Date(year, month - 1, 1).getDay();
  }, [year, month]);

  const gridCells = useMemo(() => {
    const cells = [];
    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push(null);
    }
    for (let d = 1; d <= totalDays; d++) {
      cells.push(d);
    }
    return cells;
  }, [firstDayOfWeek, totalDays]);

  const allDaysList = useMemo(() => {
    return Array.from({ length: totalDays }, (_, i) => i + 1);
  }, [totalDays]);

  const isAllSelected = useMemo(() => {
    return allDaysList.length > 0 && allDaysList.every((d) => selectedDays.includes(d));
  }, [allDaysList, selectedDays]);

  // Texto amigável resumido no botão
  const displayText = useMemo(() => {
    if (selectedDays.length === 0) return placeholder;
    if (selectedDays.length === totalDays) return `Mês Inteiro (${totalDays} dias)`;
    if (selectedDays.length <= 4) {
      return `Dias: ${selectedDays.join(', ')}`;
    }
    return `${selectedDays.length} dias selecionados`;
  }, [selectedDays, totalDays, placeholder]);

  const handleToggleDay = (day) => {
    if (disabledDays.includes(day)) return;
    if (selectedDays.includes(day)) {
      onChange(selectedDays.filter((d) => d !== day));
    } else {
      onChange([...selectedDays, day].sort((a, b) => a - b));
    }
  };

  const handleSelectAll = (select) => {
    if (select) {
      const valid = allDaysList.filter((d) => !disabledDays.includes(d));
      onChange(valid);
    } else {
      onChange([]);
    }
  };

  const handleSelectMonToSat = () => {
    const days = allDaysList.filter((d) => {
      if (disabledDays.includes(d)) return false;
      const w = new Date(year, month - 1, d).getDay();
      return w >= 1 && w <= 6;
    });
    onChange(days);
  };

  const handleSelectWeekdays = () => {
    const days = allDaysList.filter((d) => {
      if (disabledDays.includes(d)) return false;
      const w = new Date(year, month - 1, d).getDay();
      return w >= 1 && w <= 5;
    });
    onChange(days);
  };

  return (
    <div className={`relative inline-block w-full ${className}`} ref={containerRef}>
      {/* Botão Gatilho Dropdown */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs min-h-[36px] rounded-lg border transition-all text-left select-none font-medium ${
          isOpen
            ? 'bg-slate-900 border-indigo-500 text-white ring-2 ring-indigo-500/20 shadow-md'
            : 'bg-slate-900 border-slate-700/80 text-slate-200 hover:border-slate-600 hover:bg-slate-850'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
          <Calendar size={15} className="text-indigo-400 shrink-0" />
          <span className="truncate">{displayText}</span>
          {selectedDays.length > 0 && selectedDays.length < totalDays && (
            <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800/80 px-1.5 py-0.2 rounded-full font-bold shrink-0">
              {selectedDays.length}
            </span>
          )}
        </div>

        <ChevronDown
          size={15}
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-indigo-400' : ''
          }`}
        />
      </button>

      {/* Menu Suspenso Flutuante com o Calendário */}
      {isOpen && (
        <div
          className="absolute left-0 z-50 mt-1 w-[320px] sm:w-[360px] rounded-xl bg-slate-900 border border-slate-700/80 shadow-2xl backdrop-blur-md p-3.5 space-y-3 animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Cabeçalho do Popover */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div>
              <span className="text-xs font-bold text-white uppercase tracking-wider block">
                {MONTH_NAMES[month - 1]} / {year}
              </span>
              <span className="text-[10px] text-slate-400">
                Marque datas avulsas ou use os atalhos
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 text-slate-400 hover:text-white rounded"
            >
              <X size={15} />
            </button>
          </div>

          {/* Atalhos Rápidos */}
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
            <button
              type="button"
              onClick={() => handleSelectAll(!isAllSelected)}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 transition-colors font-medium"
            >
              {isAllSelected ? 'Limpar Tudo' : 'Mês Todo'}
            </button>
            <button
              type="button"
              onClick={handleSelectMonToSat}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 transition-colors font-medium"
            >
              Seg a Sáb
            </button>
            <button
              type="button"
              onClick={handleSelectWeekdays}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 transition-colors font-medium"
            >
              Seg a Sex
            </button>
          </div>

          {/* Cabeçalho dos dias da semana (D S T Q Q S S) */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold">
            {WEEKDAYS.map((wd, i) => (
              <div key={i} className={i === 0 ? 'text-red-400' : 'text-slate-400'}>
                {wd.key}
              </div>
            ))}
          </div>

          {/* Células do Calendário com Checkbox */}
          <div className="grid grid-cols-7 gap-1 max-h-[220px] overflow-y-auto">
            {gridCells.map((day, idx) => {
              if (!day) {
                return <div key={`empty-${idx}`} className="h-8 rounded" />;
              }

              const isSelected = selectedDays.includes(day);
              const isSunday = sundays.includes(day) || new Date(year, month - 1, day).getDay() === 0;
              const isHoliday = !!holidays[day];
              const isDisabled = disabledDays.includes(day);

              return (
                <button
                  key={`day-${day}`}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => handleToggleDay(day)}
                  className={`h-8 rounded-md border flex items-center justify-between px-1.5 transition-all text-xs font-semibold ${
                    isDisabled
                      ? 'bg-slate-950/40 border-slate-800/40 text-slate-600 cursor-not-allowed opacity-40'
                      : isSelected
                        ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-xs ring-1 ring-indigo-500/40'
                        : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  <span className={`${
                    isSunday ? 'text-red-400' : isHoliday ? 'text-sky-400' : isSelected ? 'text-white' : 'text-slate-300'
                  }`}>
                    {day}
                  </span>

                  <div className={`w-3.5 h-3.5 rounded flex items-center justify-center transition-all ${
                    isSelected
                      ? 'bg-indigo-600 border border-indigo-400 text-white'
                      : 'border border-slate-700 bg-slate-900 text-transparent'
                  }`}>
                    {isSelected && <Check size={10} strokeWidth={3} className="text-white" />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Rodapé do Menu */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px]">
            <span className="text-slate-400">
              Total: <strong>{selectedDays.length}</strong> de {totalDays} dias
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-3 py-1 rounded-md font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow"
            >
              Concluir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
