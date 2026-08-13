import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { Brain, Sparkles, TrendingDown, Truck, Route, Fuel, Loader2, Check, Zap } from 'lucide-react';
import { notifyError } from '@/lib/notify';

const SUGGESTION_ICONS = {
  backhaul: Route, vehicle_allocation: Truck, route: Route, consolidation: Zap, fuel: Fuel,
};

const PRIORITY_STYLES = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-50 text-slate-600 border-slate-200',
};

export default function PlanningAI() {
  const [suggestions, setSuggestions] = useState([]);
  const [trips, setTrips] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [s, t, v] = await Promise.all([
        api.entities.OptimizationSuggestion.list('-created_date'),
        api.entities.Trip.list('-created_date', 50),
        api.entities.Vehicle.list(),
      ]);
      setSuggestions(s);
      setTrips(t);
      setVehicles(v);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const activeTrips = trips.filter(t => !['livrata', 'anulata'].includes(t.status));
      const tripData = activeTrips.map(t => ({
        cmr: t.cmr_number, shipper: t.shipper_name, consignee: t.consignee_name,
        distance: t.distance_km, weight: t.weight_kg, vehicle: t.vehicle_plate, driver: t.driver_name, status: t.status,
      }));
      const vehicleData = vehicles.map(v => ({ plate: v.plate, brand: v.brand, model: v.model, consumption: v.fuel_consumption, status: v.status, mileage: v.mileage }));

      const result = await api.integrations.Core.InvokeLLM({
        prompt: `You are an AI transport optimization engine for a Romanian logistics company (Transitix). Analyze the following active trips and vehicles, and generate 3-5 actionable optimization suggestions. Focus on: reducing empty kilometers (deadhead), better vehicle allocation, fuel optimization, backhaul opportunities, and route consolidation. Return ONLY valid JSON array.

ACTIVE TRIPS: ${JSON.stringify(tripData)}
VEHICLES: ${JSON.stringify(vehicleData)}

Return an array of suggestions, each with: type (backhaul/vehicle_allocation/route/consolidation/fuel), title, suggestion (detailed text), potential_savings_eur (number), potential_savings_km (number or 0), priority (high/medium/low).`,
        response_json_schema: {
          type: 'object',
          properties: {
            suggestions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' }, title: { type: 'string' }, suggestion: { type: 'string' },
                  potential_savings_eur: { type: 'number' }, potential_savings_km: { type: 'number' },
                  priority: { type: 'string' },
                }
              }
            }
          }
        }
      });

      const newSuggestions = (result.suggestions || []).map(s => ({
        type: s.type || 'route', title: s.title, suggestion: s.suggestion,
        potential_savings_eur: s.potential_savings_eur || 0,
        potential_savings_km: s.potential_savings_km || 0,
        priority: s.priority || 'medium', is_applied: false,
      }));

      if (newSuggestions.length > 0) {
        await api.entities.OptimizationSuggestion.bulkCreate(newSuggestions);
      }
      await loadData();
    } catch (e) {
      console.error(e);
      notifyError('Analiză AI eșuată', e);
    } finally { setAnalyzing(false); }
  };

  const applySuggestion = async (id) => {
    await api.entities.OptimizationSuggestion.update(id, { is_applied: true });
    loadData();
  };

  const deleteSuggestion = async (id) => {
    await api.entities.OptimizationSuggestion.delete(id);
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  const totalSavings = suggestions.filter(s => !s.is_applied).reduce((sum, s) => sum + (s.potential_savings_eur || 0), 0);

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight flex items-center gap-2">
            <Brain className="w-6 h-6 text-[#F5A623]" /> Planning AI
          </h1>
          <p className="text-sm text-slate-500 mt-1">Optimizare rute și resurse cu inteligență artificială</p>
        </div>
        <button onClick={runAnalysis} disabled={analyzing} className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50 transition-colors">
          {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Analizez...</> : <><Sparkles className="w-4 h-4" /> Rulează analiză AI</>}
        </button>
      </div>

      {totalSavings > 0 && (
        <div className="bg-gradient-to-r from-[#0A2B4E] to-[#1D4E89] rounded-xl p-6 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center"><TrendingDown className="w-7 h-7" /></div>
            <div>
              <p className="text-sm text-white/70">Economie potențială totală</p>
              <p className="text-3xl font-bold">{totalSavings.toLocaleString('ro-RO')} EUR</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-sm text-white/70">Sugestii active</p>
              <p className="text-2xl font-bold">{suggestions.filter(s => !s.is_applied).length}</p>
            </div>
          </div>
        </div>
      )}

      {analyzing && (
        <div className="bg-white rounded-xl border border-slate-200/80 p-8 shadow-sm text-center">
          <Loader2 className="w-10 h-10 text-[#0A2B4E] animate-spin mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-700">Analizez cursele active și vehiculele...</p>
          <p className="text-xs text-slate-400 mt-1">Identific oportunități de optimizare, curse de retur și reducere km goi</p>
        </div>
      )}

      <div className="space-y-3">
        {suggestions.length > 0 ? suggestions.map(s => {
          const Icon = SUGGESTION_ICONS[s.type] || Sparkles;
          return (
            <div key={s.id} className={`bg-white rounded-xl border shadow-sm p-5 transition-opacity ${s.is_applied ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-lg bg-[#0A2B4E] flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-semibold text-[#0A2B4E]">{s.title}</h3>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${PRIORITY_STYLES[s.priority] || PRIORITY_STYLES.medium}`}>
                      {s.priority === 'high' ? 'Prioritate mare' : s.priority === 'medium' ? 'Prioritate medie' : 'Prioritate mică'}
                    </span>
                    {s.is_applied && <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"><Check className="w-3 h-3" /> Aplicată</span>}
                  </div>
                  <p className="text-sm text-slate-600 mb-2">{s.suggestion}</p>
                  <div className="flex gap-4 flex-wrap text-xs">
                    {s.potential_savings_eur > 0 && <span className="flex items-center gap-1 text-emerald-600 font-medium"><TrendingDown className="w-3.5 h-3.5" /> {s.potential_savings_eur} EUR economie</span>}
                    {s.potential_savings_km > 0 && <span className="flex items-center gap-1 text-[#1D4E89] font-medium"><Route className="w-3.5 h-3.5" /> {s.potential_savings_km} km reduși</span>}
                  </div>
                </div>
                {!s.is_applied && (
                  <div className="flex flex-col gap-2 shrink-0">
                    <button onClick={() => applySuggestion(s.id)} className="px-3 py-1.5 text-xs font-medium text-white bg-[#27AE60] rounded-lg hover:bg-emerald-600">Aplică</button>
                    <button onClick={() => deleteSuggestion(s.id)} className="px-3 py-1.5 text-xs font-medium text-red-500 bg-red-50 rounded-lg hover:bg-red-100">Respinge</button>
                  </div>
                )}
              </div>
            </div>
          );
        }) : !analyzing && (
          <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center text-slate-400 shadow-sm">
            <Brain className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium text-slate-500 mb-1">Nu există sugestii de optimizare</p>
            <p className="text-xs text-slate-400">Apasă „Rulează analiză AI" pentru a genera sugestii personalizate</p>
          </div>
        )}
      </div>
    </div>
  );
}