import React from 'react';

const Skeleton = ({ type = 'text', rows = 1, columns = 1, className = '' }) => {
  if (type === 'table') {
    return (
      <div className={`w-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl ${className}`}>
        {/* Header Skeleton */}
        <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 grid gap-4 animate-pulse" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className="h-4 bg-slate-800 rounded w-full"></div>
          ))}
        </div>
        {/* Rows Skeleton */}
        <div className="divide-y divide-slate-800/50">
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div key={rowIndex} className="px-6 py-4 grid gap-4 animate-pulse" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {Array.from({ length: columns }).map((_, colIndex) => (
                <div key={colIndex} className="h-4 bg-slate-800/50 rounded w-full"></div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'card') {
    return (
      <div className={`bg-slate-900 border border-slate-800 rounded-xl p-6 animate-pulse ${className}`}>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-xl bg-slate-800"></div>
          <div className="h-6 bg-slate-800 rounded w-1/3"></div>
        </div>
        <div className="h-10 bg-slate-800 rounded w-1/2 mb-4"></div>
        <div className="h-4 bg-slate-800 rounded w-1/4"></div>
      </div>
    );
  }

  if (type === 'list') {
    return (
      <div className={`space-y-4 ${className}`}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-12 bg-slate-900 border border-slate-800 rounded-xl animate-pulse"></div>
        ))}
      </div>
    );
  }

  // Default text/block skeleton
  return (
    <div className={`animate-pulse bg-slate-800 rounded ${className}`}></div>
  );
};

export default Skeleton;
