import React, { useMemo } from 'react';
import { Calendar, CheckSquare, Square, Check } from 'lucide-react';
import StyledCheckbox from './StyledCheckbox';

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
 * Componente de Calendário Mensal com seleção individual e em lote por checkboxes nas datas.
 * 
 * Props:
 * - year: number
 * - month: number (1-12)
 * - selectedDays: number[] (lista de números dos dias selecionados, ex: [1, 2, 5, 10])
 * - onChange: (days: number[]) => void
 * - holidays?: Record<number, string> | Record<string, string>
 * - sundays?: number[]
 * - disabledDays?: number[]
 * - className?: string
 * - title?: string
 */
export default function CalendarCheckboxPicker({
  year,
  month,
  selectedDays = [],
  onChange,
  holidays = {},
  sundays = [],
  disabledDays = [],
  className = '',
  title = null
}) {
  // Quantidade de dias no mês
  const totalDays = useMemo(() => {
    return new Date(year, month, 0).getDate();
  }, [year, month]);

  // Primeiro dia da semana (0=Dom, 1=Seg, ..., 6=Sáb)
  const firstDayOfWeek = useMemo(() => {
    return new Date(year, month - 1, 1).getDay();
  }, [year, month]);

  // Dias em formato de array para a grade
  const gridCells = useMemo(() => {
    const cells = [];
    // Espaços vazios antes do primeiro dia
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

  // Alterna um dia específico
  const handleToggleDay = (day) => {
    if (disabledDays.includes(day)) return;
    if (selectedDays.includes(day)) {
      onChange(selectedDays.filter((d) => d !== day));
    } else {
      onChange([...selectedDays, day].sort((a, b) => a - b));
    }
  };

  // Selecionar / Desmarcar Todos
  const handleSelectAll = (select) => {
    if (select) {
      const validDays = allDaysList.filter((d) => !disabledDays.includes(d));
      onChange(validDays);
    } else {
      onChange([]);
    }
  };

  // Selecionar dias úteis (Segunda a Sexta)
  const handleSelectWeekdays = () => {
    const workdays = allDaysList.filter((d) => {
      if (disabledDays.includes(d)) return false;
      const w = new Date(year, month - 1, d).getDay();
      return w >= 1 && w <= 5; // Seg a Sex
    });
    onChange(workdays);
  };

  // Selecionar Segunda a Sábado
  const handleSelectMonToSat = () => {
    const days = allDaysList.filter((d) => {
      if (disabledDays.includes(d)) return false;
      const w = new Date(year, month - 1, d).getDay();
      return w >= 1 && w <= 6; // Seg a Sáb
    });
    onChange(days);
  };

  return (
    <div className={`bg-slate-950 border border-slate-800 rounded-xl p-3.5 shadow-md ${className}`}>
      {/* Cabeçalho do Calendário */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-indigo-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            {title || `${MONTH_NAMES[month - 1]} de ${year}`}
          </span>
          <span className="text-[11px] text-indigo-300 bg-indigo-950/70 border border-indigo-800/80 px-2 py-0.5 rounded-full font-semibold">
            {selectedDays.length} de {totalDays} dias
          </span>
        </div>

        {/* Ações Rápidas de Seleção em Lote */}
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          <button
            type="button"
            onClick={() => handleSelectAll(!isAllSelected)}
            className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors font-medium"
          >
            {isAllSelected ? 'Limpar Tudo' : 'Mês Inteiro'}
          </button>
          <button
            type="button"
            onClick={handleSelectMonToSat}
            className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors font-medium"
          >
            Seg a Sáb
          </button>
          <button
            type="button"
            onClick={handleSelectWeekdays}
            className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors font-medium"
          >
            Seg a Sex
          </button>
        </div>
      </div>

      {/* Grade de Dias da Semana (D S T Q Q S S) */}
      <div className="grid grid-cols-7 gap-1 mt-3 mb-1.5 text-center">
        {WEEKDAYS.map((wd, i) => (
          <div
            key={i}
            className={`text-[10px] font-bold py-1 ${
              i === 0 ? 'text-red-400' : 'text-slate-400'
            }`}
          >
            {wd.key}
          </div>
        ))}
      </div>

      {/* Matriz de Células de Dias com Checkbox Integrado */}
      <div className="grid grid-cols-7 gap-1">
        {gridCells.map((day, idx) => {
          if (!day) {
            return <div key={`empty-${idx}`} className="h-10 rounded-lg bg-transparent" />;
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
              className={`relative h-11 rounded-lg border flex flex-col items-center justify-between p-1 transition-all group ${
                isDisabled
                  ? 'bg-slate-900/40 border-slate-800/40 text-slate-600 cursor-not-allowed opacity-50'
                  : isSelected
                    ? 'bg-indigo-600/25 border-indigo-500 text-white shadow-xs ring-1 ring-indigo-500/30'
                    : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              {/* Topo do dia: Número e Indicador de Domingo/Feriado */}
              <div className="w-full flex items-center justify-between px-0.5">
                <span className={`text-[11px] font-bold ${
                  isSunday ? 'text-red-400' : isHoliday ? 'text-sky-400' : isSelected ? 'text-white' : 'text-slate-300'
                }`}>
                  {day}
                </span>

                {/* Checkbox em miniatura estilizado */}
                <div className={`w-3.5 h-3.5 rounded flex items-center justify-center transition-all ${
                  isSelected
                    ? 'bg-indigo-600 border border-indigo-400 text-white'
                    : 'border border-slate-700 bg-slate-950 group-hover:border-slate-500 text-transparent'
                }`}>
                  {isSelected && <Check size={10} strokeWidth={3} className="text-white" />}
                </div>
              </div>

              {/* Rótulo inferior para Domingos e Feriados */}
              <div className="w-full text-center">
                {isHoliday ? (
                  <span className="text-[8px] font-bold text-sky-400 uppercase tracking-tighter block truncate px-0.5" title={holidays[day]}>
                    fer
                  </span>
                ) : isSunday ? (
                  <span className="text-[8px] font-bold text-red-400/80 uppercase tracking-tighter block truncate px-0.5">
                    dsr
                  </span>
                ) : (
                  <span className="text-[8px] text-slate-500 block opacity-0 group-hover:opacity-100 transition-opacity">
                    {isSelected ? 'selec.' : 'marcar'}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
