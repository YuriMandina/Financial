import React from 'react';
import { Check } from 'lucide-react';

/**
 * Checkbox estilizado e acessível para o sistema Financial.
 * 
 * Props:
 * - checked: boolean
 * - onChange: (checked: boolean) => void
 * - label?: string | React.ReactNode
 * - description?: string
 * - disabled?: boolean
 * - size?: 'sm' | 'md' | 'lg'
 * - className?: string
 * - id?: string
 */
export default function StyledCheckbox({
  checked = false,
  onChange,
  label = null,
  description = null,
  disabled = false,
  size = 'md',
  className = '',
  id = undefined
}) {
  const inputId = id || (label ? `chk-${Math.random().toString(36).substring(2, 9)}` : undefined);

  const boxSizes = {
    sm: 'w-3.5 h-3.5 rounded',
    md: 'w-4 h-4 rounded-md',
    lg: 'w-5 h-5 rounded-md'
  };

  const checkSizes = {
    sm: 10,
    md: 12,
    lg: 14
  };

  const handleClick = (e) => {
    if (disabled) return;
    if (onChange) {
      onChange(!checked);
    }
  };

  return (
    <label
      htmlFor={inputId}
      onClick={handleClick}
      className={`inline-flex items-start gap-2.5 select-none transition-opacity ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer group'
      } ${className}`}
    >
      <div className="relative flex items-center justify-center shrink-0 mt-0.5">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={() => {}} // controlado pelo label/div
          className="sr-only"
        />

        <div
          className={`${boxSizes[size] || boxSizes.md} border flex items-center justify-center transition-all duration-150 ${
            checked
              ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs shadow-indigo-500/30'
              : 'bg-slate-950 border-slate-700/80 group-hover:border-slate-500 text-transparent'
          } ${
            !disabled && !checked ? 'group-hover:bg-slate-900' : ''
          }`}
        >
          {checked && (
            <Check
              size={checkSizes[size] || checkSizes.md}
              strokeWidth={3}
              className="text-white animate-in zoom-in-75 duration-150"
            />
          )}
        </div>
      </div>

      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <span className={`text-xs font-medium transition-colors ${
              checked ? 'text-white' : 'text-slate-300 group-hover:text-slate-100'
            }`}>
              {label}
            </span>
          )}
          {description && (
            <span className="text-[10px] text-slate-400 mt-0.5">
              {description}
            </span>
          )}
        </div>
      )}
    </label>
  );
}
