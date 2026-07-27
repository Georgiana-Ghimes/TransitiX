import React from 'react';
import { Settings as SettingsIcon, Building2, Bell, Save } from 'lucide-react';

export default function Settings() {
  const inputCls = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors";
  const labelCls = "block text-xs font-medium text-slate-600 mb-1";

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Setări</h1>
        <p className="text-sm text-slate-500 mt-1">Configurare companie și notificări</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-5 border-b border-slate-100">
          <Building2 className="w-5 h-5 text-[#1D4E89]" />
          <h2 className="font-semibold text-[#0A2B4E]">Date companie</h2>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={labelCls}>Denumire</label><input className={inputCls} placeholder="Nume companie" /></div>
            <div><label className={labelCls}>CUI</label><input className={inputCls} placeholder="Cod fiscal" /></div>
            <div className="sm:col-span-2"><label className={labelCls}>Adresă</label><input className={inputCls} placeholder="Adresă sediu" /></div>
            <div><label className={labelCls}>Telefon</label><input className={inputCls} placeholder="Telefon" /></div>
            <div><label className={labelCls}>Email</label><input className={inputCls} placeholder="email@companie.ro" /></div>
            <div><label className={labelCls}>Regim TVA</label><select className={inputCls}><option>Plătitor TVA</option><option>Neplătitor TVA</option></select></div>
            <div><label className={labelCls}>Monedă</label><select className={inputCls}><option>RON</option><option>EUR</option></select></div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-5 border-b border-slate-100">
          <Bell className="w-5 h-5 text-[#F5A623]" />
          <h2 className="font-semibold text-[#0A2B4E]">Notificări expirare documente</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-500">Praguri alerte (zile înainte de expirare):</p>
          <div className="flex gap-3 flex-wrap">
            {[30, 15, 7, 1].map(days => (
              <label key={days} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg cursor-pointer">
                <input type="checkbox" defaultChecked className="rounded" />
                <span className="text-sm text-slate-700">{days} zile</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] transition-colors">
          <Save className="w-4 h-4" /> Salvează setările
        </button>
      </div>
    </div>
  );
}