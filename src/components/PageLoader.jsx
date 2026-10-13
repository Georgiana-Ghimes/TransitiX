import React from 'react';

/** Inline page spinner — used inside Layout so the sidebar stays mounted while a route chunk loads. */
export default function PageLoader({ className = 'h-96' }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
    </div>
  );
}
