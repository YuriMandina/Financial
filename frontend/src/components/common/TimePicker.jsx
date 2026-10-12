import React, { useState, useRef, useEffect } from 'react';
import { Clock, Check } from 'lucide-react';

// ==============================================================================
// --- [BLOCO: COMPONENTE CUSTOMIZADO TimePicker] ---
// ==============================================================================

const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTOS = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

const ATALHOS_COMUNS = [
  '07:00', '08:00', '09:00', '12:00', '13:00', '14:00', '16:00', '17:00', '18:00', '19:00'
];

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

  const handleSelectShortcut = (timeStr) => {
    onChange(timeStr);
    setOpen(false);
  };

  const handleManualInput = (e) => {
    let val = e.target.value.replace(/[^0-9:]/g, '');
    if (val.length === 2 && !val.includes(':') && e.nativeEvent.inputType !== 'deleteContentBackward') {
      val = val + ':';
    }
    if (val.length <= 5) {
      onChange(val);
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Botão Acionador estilizado */}
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

      {/* Popover Dropdown de Seleção */}
      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 w-64 bg-slate-900 border border-slate-700/90 rounded-xl shadow-2xl p-3 text-xs space-y-3 backdrop-blur-none animate-in fade-in zoom-in-95 duration-100">
          
          {/* Campo de digitação rápida */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
            <span className="text-[11px] text-slate-400 font-medium">Horário:</span>
            <input
              type="text"
              maxLength={5}
              placeholder="HH:mm"
              value={value}
              onChange={handleManualInput}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-center font-mono font-bold text-white text-xs focus:outline-none focus:border-indigo-500"
            />
            {value && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange('');
                }}
                className="text-[10px] text-slate-500 hover:text-slate-300 px-1"
                title="Limpar"
              >
                ✕
              </button>
            )}
          </div>

          {/* Atalhos rápidos comuns */}
          <div>
            <span className="block text-[10px] text-slate-500 mb-1 font-semibold uppercase tracking-wider">
              Atalhos Rápidos
            </span>
            <div className="grid grid-cols-5 gap-1">
              {ATALHOS_COMUNS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleSelectShortcut(t)}
                  className={`
                    py-1 text-[11px] font-mono rounded text-center transition
                    ${value === t
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'bg-slate-950/90 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'}
                  `}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Colunas de Seleção: Horas e Minutos */}
          <div className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-2">
            {/* Coluna Horas */}
            <div>
              <span className="block text-center text-[10px] text-slate-400 font-bold mb-1">
                HORA
              </span>
              <div className="h-36 overflow-y-auto pr-1 space-y-0.5 scrollbar-thin scrollbar-thumb-slate-700">
                {HORAS.map((h) => {
                  const isSelected = currentH === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => handleSelectHour(h)}
                      className={`
                        w-full py-1 text-center font-mono rounded text-xs transition
                        ${isSelected
                          ? 'bg-indigo-600 text-white font-bold'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'}
                      `}
                    >
                      {h}h
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Coluna Minutos */}
            <div>
              <span className="block text-center text-[10px] text-slate-400 font-bold mb-1">
                MINUTO
              </span>
              <div className="h-36 overflow-y-auto pr-1 space-y-0.5 scrollbar-thin scrollbar-thumb-slate-700">
                {MINUTOS.map((m) => {
                  const isSelected = currentM === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleSelectMinute(m)}
                      className={`
                        w-full py-1 text-center font-mono rounded text-xs transition
                        ${isSelected
                          ? 'bg-indigo-600 text-white font-bold'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'}
                      `}
                    >
                      :{m}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Botão de Fechar / Confirmar */}
          <div className="pt-2 border-t border-slate-800 flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1 transition"
            >
              <Check size={12} />
              Confirmar
            </button>
          </div>

        </div>
      )}
    </div>
  );
}
