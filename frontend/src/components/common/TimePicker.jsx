import React, { useState, useRef, useEffect } from 'react';
import { Clock } from 'lucide-react';

// ==============================================================================
// --- [BLOCO: COMPONENTE CUSTOMIZADO TimePicker (PURO, ENCAIXADO E COMPACTO)] ---
// ==============================================================================

const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTOS = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

export default function TimePicker({
  value = '',
  onChange,
  disabled = false,
  placeholder = '00:00',
  className = ''
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Decompor o valor atual em hora e minuto
  const [currentH, currentM] = (value && value.includes(':'))
    ? value.split(':')
    : ['', ''];

  // Fechar ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectHour = (h) => {
    const newM = currentM || '00';
    onChange(`${h}:${newM}`);
  };

  const handleSelectMinute = (m) => {
    const newH = currentH || '08';
    onChange(`${newH}:${m}`);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* --- [BLOCO: BOTÃO ACIONADOR] --- */}
      <div
        onClick={() => { if (!disabled) setOpen((prev) => !prev); }}
        className={`
          w-full flex items-center justify-between h-9 px-3 rounded-lg border text-xs font-medium transition-all cursor-pointer
          ${open
            ? 'bg-indigo-600/20 border-indigo-500/70 text-indigo-200 shadow-lg shadow-indigo-500/10'
            : 'bg-slate-950/80 border-slate-700/80 text-slate-200 hover:border-indigo-500/50 hover:bg-slate-900'}
          ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}
        `}
      >
        <div className="flex items-center gap-2">
          <Clock size={14} className={open ? 'text-indigo-400' : 'text-slate-400'} />
          <span className={`font-mono text-xs ${value ? 'text-white font-semibold' : 'text-slate-500'}`}>
            {value || placeholder}
          </span>
        </div>
        <span className="text-[10px] text-slate-500">▼</span>
      </div>

      {/* --- [BLOCO: DROPDOWN ENCAIXADO PURO (HORAS E MINUTOS)] --- */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 w-full min-w-[120px] bg-slate-900 border border-slate-700/90 rounded-xl shadow-2xl p-2 text-xs backdrop-blur-none animate-in fade-in zoom-in-95 duration-100">
          
          {/* Seletores de Horas e Minutos */}
          <div className="grid grid-cols-2 gap-1.5">
            {/* Coluna Horas */}
            <div>
              <span className="block text-center text-[10px] text-slate-500 font-bold mb-1">
                HORA
              </span>
              <div className="h-48 overflow-y-auto pr-0.5 space-y-0.5 scrollbar-thin scrollbar-thumb-slate-700">
                {HORAS.map((h) => {
                  const isSelected = currentH === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => handleSelectHour(h)}
                      className={`
                        w-full py-1 text-center font-mono rounded text-[11px] transition
                        ${isSelected
                          ? 'bg-indigo-600 text-white font-bold shadow-sm'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'}
                      `}
                    >
                      {h}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Coluna Minutos */}
            <div>
              <span className="block text-center text-[10px] text-slate-500 font-bold mb-1">
                MIN
              </span>
              <div className="h-48 overflow-y-auto pr-0.5 space-y-0.5 scrollbar-thin scrollbar-thumb-slate-700">
                {MINUTOS.map((m) => {
                  const isSelected = currentM === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleSelectMinute(m)}
                      className={`
                        w-full py-1 text-center font-mono rounded text-[11px] transition
                        ${isSelected
                          ? 'bg-indigo-600 text-white font-bold shadow-sm'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'}
                      `}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
