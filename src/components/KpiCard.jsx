import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export default function KpiCard({ icon: Icon, label, value, subtitle, accent = 'primary', to }) {
  const accents = {
    primary: 'bg-[#0A2B4E] text-white',
    secondary: 'bg-[#1D4E89] text-white',
    accent: 'bg-[#F5A623] text-[#0A2B4E]',
    success: 'bg-[#27AE60] text-white',
    danger: 'bg-[#E74C3C] text-white',
  };

  const content = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="text-3xl font-bold text-[#0A2B4E] mt-2 tracking-tight">{value}</p>
        {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
      </div>
      {Icon && (
        <div className={cn('w-11 h-11 rounded-lg flex items-center justify-center', accents[accent])}>
          <Icon className="w-5 h-5" />
        </div>
      )}
    </div>
  );

  const className = cn(
    'bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm transition-shadow block',
    to && 'hover:shadow-md hover:border-[#1D4E89]/30 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4E89]/40'
  );

  if (to) {
    return (
      <Link to={to} className={className} aria-label={`${label}: ${value}`}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
