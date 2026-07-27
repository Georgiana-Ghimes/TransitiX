import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import WarehouseProductForm from '@/components/WarehouseProductForm';
import { Plus, Search, Package, AlertTriangle, ArrowDown, ArrowUp, Boxes } from 'lucide-react';

const UNIT_LABELS = { kg: 'kg', mc: 'mc', piece: 'buc', pallet: 'palet' };

export default function Warehouse() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => { loadProducts(); }, []);

  const loadProducts = async () => {
    try { setProducts(await base44.entities.WarehouseProduct.list()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Ștergeți acest produs?')) return;
    await base44.entities.WarehouseProduct.delete(id);
    loadProducts();
  };

  const adjustStock = async (product, delta) => {
    const newQty = Math.max(0, (product.quantity || 0) + delta);
    await base44.entities.WarehouseProduct.update(product.id, { quantity: newQty });
    loadProducts();
  };

  const filtered = products.filter(p =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase())
  );

  const totalValue = products.reduce((s, p) => s + (p.quantity || 0) * (p.unit_price || 0), 0);
  const lowStock = products.filter(p => (p.quantity || 0) <= (p.min_quantity || 0)).length;

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Depozit (WMS)</h1>
          <p className="text-sm text-slate-500 mt-1">{filtered.length} produse · valoare stoc: {totalValue.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON</p>
        </div>
        <button onClick={() => { setEditProduct(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] transition-colors"><Plus className="w-4 h-4" /> Produs nou</button>
      </div>

      {lowStock > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          <p className="text-sm text-amber-700">{lowStock} produs(e) sub stocul minim — necesită reaprovizionare.</p>
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Caută după SKU sau denumire..." className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89]" />
      </div>

      {filtered.length > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 text-xs">
                  <th className="text-left font-medium px-4 py-3">SKU</th>
                  <th className="text-left font-medium px-4 py-3">Produs</th>
                  <th className="text-left font-medium px-4 py-3">Locație</th>
                  <th className="text-center font-medium px-4 py-3">Cantitate</th>
                  <th className="text-center font-medium px-4 py-3">Stoc</th>
                  <th className="text-right font-medium px-4 py-3">Valoare</th>
                  <th className="text-right font-medium px-4 py-3">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const isLow = (p.quantity || 0) <= (p.min_quantity || 0);
                  return (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-[#0A2B4E]">{p.sku}</td>
                      <td className="px-4 py-3"><p className="font-medium text-slate-700">{p.name}</p>{p.description && <p className="text-xs text-slate-400 truncate max-w-xs">{p.description}</p>}</td>
                      <td className="px-4 py-3 text-slate-500">{p.location || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => adjustStock(p, -1)} className="w-7 h-7 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center"><ArrowDown className="w-3.5 h-3.5" /></button>
                          <span className="w-16 text-center font-medium">{p.quantity || 0} {UNIT_LABELS[p.unit] || 'buc'}</span>
                          <button onClick={() => adjustStock(p, 1)} className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center"><ArrowUp className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isLow ? <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><AlertTriangle className="w-3 h-3" /> Minim</span> : <span className="text-xs text-emerald-600">OK</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">{((p.quantity || 0) * (p.unit_price || 0)).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => { setEditProduct(p); setShowForm(true); }} className="text-[#1D4E89] hover:underline text-xs">Editează</button>
                        <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:underline text-xs ml-2">Șterge</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200/80 p-12 text-center text-slate-400 shadow-sm">
          <Boxes className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nu există produse. Adaugă primul produs.</p>
        </div>
      )}

      {showForm && <WarehouseProductForm product={editProduct} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); loadProducts(); }} />}
    </div>
  );
}