import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';

/**
 * Dropdown estilizado e acessível para o sistema Financial.
 * 
 * Props:
 * - value: any (valor selecionado)
 * - onChange: (value: any) => void
 * - options: Array<{ value: any, label: string, icon?: React.ReactNode, subtitle?: string, disabled?: boolean }>
 * - placeholder?: string
 * - disabled?: boolean
 * - searchable?: boolean
 * - size?: 'sm' | 'md' | 'lg'
 * - direction?: 'down' | 'up'
 * - className?: string
 * - buttonClassName?: string
 * - menuClassName?: string
 * - icon?: React.ReactNode (ícone prefixo no botão)
 * - renderOption?: (option: object, isSelected: boolean) => React.ReactNode
 */
export default function SelectDropdown({
  value,
  onChange,
  options = [],
  placeholder = 'Selecione...',
  disabled = false,
  searchable = false,
  size = 'md',
  direction = 'down',
  className = '',
  buttonClassName = '',
  menuClassName = '',
  icon = null,
  renderOption = null
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

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

  // Foco automático na busca quando abrir
  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    if (!isOpen) {
      setSearchTerm('');
    }
  }, [isOpen, searchable]);

  // Encontra a opção selecionada atual
  const selectedOption = useMemo(() => {
    return options.find((opt) => String(opt.value) === String(value));
  }, [options, value]);

  // Filtra opções pela busca
  const filteredOptions = useMemo(() => {
    if (!searchable || !searchTerm.trim()) return options;
    const term = searchTerm.toLowerCase().trim();
    return options.filter((opt) => 
      (opt.label && opt.label.toLowerCase().includes(term)) ||
      (opt.subtitle && opt.subtitle.toLowerCase().includes(term))
    );
  }, [options, searchable, searchTerm]);

  const handleSelect = (option) => {
    if (option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
  };

  // Variações de tamanho
  const sizeClasses = {
    sm: 'px-2.5 py-1 text-xs min-h-[30px]',
    md: 'px-3 py-1.5 text-xs min-h-[36px]',
    lg: 'px-3.5 py-2 text-sm min-h-[42px]'
  };

  return (
    <div className={`relative inline-block w-full ${className}`} ref={containerRef}>
      {/* Botão Gatilho */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border transition-all text-left select-none font-medium ${
          sizeClasses[size] || sizeClasses.md
        } ${
          disabled
            ? 'bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed opacity-60'
            : isOpen
              ? 'bg-slate-900 border-indigo-500 text-white ring-2 ring-indigo-500/20 shadow-md'
              : 'bg-slate-900 border-slate-700/80 text-slate-200 hover:border-slate-600 hover:bg-slate-850'
        } ${buttonClassName}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {icon && <span className="text-slate-400 shrink-0">{icon}</span>}
          {selectedOption ? (
            <div className="flex items-center gap-2 truncate">
              {selectedOption.icon && <span className="shrink-0">{selectedOption.icon}</span>}
              <span className="truncate">{selectedOption.label}</span>
              {selectedOption.subtitle && (
                <span className="text-[10px] text-slate-400 truncate hidden sm:inline">
                  ({selectedOption.subtitle})
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-500 truncate">{placeholder}</span>
          )}
        </div>

        <ChevronDown
          size={15}
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-indigo-400' : ''
          }`}
        />
      </button>

      {/* Menu Dropdown Suspenso */}
      {isOpen && (
        <div
          className={`absolute left-0 right-0 z-50 rounded-xl bg-slate-900 border border-slate-700/80 shadow-2xl backdrop-blur-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${
            direction === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
          } ${menuClassName}`}
          style={{ maxHeight: '280px' }}
        >
          {/* Campo de Busca Opcional */}
          {searchable && (
            <div className="p-2 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur-xs z-10">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Pesquisar..."
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-md pl-7 pr-7 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Lista de Opções */}
          <div className="max-h-[220px] overflow-y-auto p-1 divide-y divide-slate-800/40 custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-500 italic">
                Nenhuma opção encontrada.
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = String(opt.value) === String(value);
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => handleSelect(opt)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                      opt.disabled
                        ? 'text-slate-600 cursor-not-allowed'
                        : isSelected
                          ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                  >
                    {renderOption ? (
                      renderOption(opt, isSelected)
                    ) : (
                      <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                        {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                        <div className="truncate">
                          <div className="truncate">{opt.label}</div>
                          {opt.subtitle && (
                            <div className={`text-[10px] truncate ${isSelected ? 'text-indigo-200' : 'text-slate-500'}`}>
                              {opt.subtitle}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {isSelected && (
                      <Check size={14} className="shrink-0 text-white" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
