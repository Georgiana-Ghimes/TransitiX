import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/api/client';
import StatusBadge from '@/components/StatusBadge';
import { formatDate } from '@/lib/utils';
import {
  ArrowLeft, Upload, FileText, CheckCircle, Send, MapPin, Package, Truck, User,
  AlertTriangle, Loader2, Copy, ExternalLink,
} from 'lucide-react';

export default function TripDetail() {
  const { id } = useParams();
  const [trip, setTrip] = useState(null);
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [clientLink, setClientLink] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { loadData(); }, [id]);

  const loadData = async () => {
    try {
      const t = await api.entities.Trip.get(id);
      setTrip(t);
      const docs = await api.entities.TripDocument.filter({ trip_id: id });
      if (docs.length > 0) setDoc(docs[0]);
      else setDoc(null);
      const confs = await api.entities.ClientConfirmation.filter({ trip_id: id });
      if (confs.length > 0) {
        const conf = confs[0];
        setConfirmation(conf);
        setClientLink(`${window.location.origin}/confirm/${conf.token}`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await api.integrations.Core.UploadFile({ file });
      let existing = doc;
      if (!existing) {
        existing = await api.entities.TripDocument.create({
          trip_id: id,
          cmr_number: trip.cmr_number,
          original_image_url: file_url,
          is_confirmed: false,
        });
      } else {
        existing = await api.entities.TripDocument.update(existing.id, {
          original_image_url: file_url,
          is_confirmed: false,
          ocr_extracted_data: null,
        });
      }
      setDoc(existing);
      await runOCR(existing.id, file_url);
    } catch (err) {
      console.error(err);
      alert('Eroare la upload: ' + (err.message || ''));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const runOCR = async (docId, imageUrl) => {
    setOcrProcessing(true);
    try {
      const result = await api.integrations.Core.InvokeLLM({
        prompt:
          'You are an OCR system for CMR documents. Extract: cmr_number, date, shipper, consignee, goods_description, weight, packages.',
        file_urls: imageUrl ? [imageUrl] : [],
        trip_id: id,
        trip_context: trip,
        response_json_schema: {
          type: 'object',
          properties: {
            cmr_number: { type: 'string' },
            date: { type: 'string' },
            shipper: { type: 'string' },
            consignee: { type: 'string' },
            goods_description: { type: 'string' },
            weight: { type: 'string' },
            packages: { type: 'string' },
          },
        },
      });
      const updated = await api.entities.TripDocument.update(docId, {
        ocr_extracted_data: result,
        is_confirmed: false,
      });
      setDoc(updated);
    } catch (err) {
      console.error(err);
      alert('Eroare OCR: ' + (err.message || ''));
    } finally {
      setOcrProcessing(false);
    }
  };

  const confirmOCR = async () => {
    try {
      const user = await api.auth.me();
      await api.entities.TripDocument.update(doc.id, {
        is_confirmed: true,
        ocr_verified_by: user?.full_name || user?.email || 'Admin',
        ocr_verified_at: new Date().toISOString(),
      });
      await loadData();
    } catch (err) {
      alert('Eroare la confirmare OCR: ' + (err.message || ''));
    }
  };

  const sendClientLink = async () => {
    setSendingLink(true);
    try {
      const { confirmation: conf, link } = await api.trips.createConfirmationLink(id, {
        origin: window.location.origin,
        client_email: trip.consignee_email || undefined,
      });
      setConfirmation(conf);
      setClientLink(link);

      try {
        await api.integrations.Core.SendEmail({
          to: conf.client_email || 'client@exemplu.ro',
          subject: `Confirmare recepție marfă - CMR ${trip.cmr_number}`,
          body: `Pentru a confirma recepția mărfii pentru CMR ${trip.cmr_number}, accesați linkul:\n${link}\n\nExpeditor: ${trip.shipper_name}\nDestinatar: ${trip.consignee_name}\nMarfă: ${trip.goods_description || '-'}\nGreutate: ${trip.weight_kg || '-'} kg`,
        });
      } catch {
        // email is stub — link still works
      }
    } catch (err) {
      console.error(err);
      alert('Eroare la generare link: ' + (err.message || ''));
    } finally {
      setSendingLink(false);
    }
  };

  const copyLink = async () => {
    if (!clientLink) return;
    try {
      await navigator.clipboard.writeText(clientLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt('Copiază linkul:', clientLink);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }
  if (!trip) {
    return (
      <div className="p-8 text-center text-slate-500">
        Cursa nu a fost găsită.{' '}
        <Link to="/trips" className="text-[#1D4E89]">
          Înapoi la curse
        </Link>
      </div>
    );
  }

  const ocr = doc?.ocr_extracted_data || {};
  const hasOcrData = Boolean(
    ocr.cmr_number || ocr.shipper || ocr.consignee || ocr.goods_description || ocr.weight || ocr.packages
  );

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <Link to="/trips" className="flex items-center gap-2 text-sm text-slate-500 hover:text-[#1D4E89]">
        <ArrowLeft className="w-4 h-4" /> Înapoi la curse
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">
              {trip.cmr_number || 'Cursă fără CMR'}
            </h1>
            <StatusBadge status={trip.status} />
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {trip.shipper_name} → {trip.consignee_name}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#F5A623] pl-2 mb-3">
            Expeditor
          </h3>
          <div className="space-y-2 text-sm text-slate-600">
            <p className="font-medium text-slate-800">{trip.shipper_name}</p>
            {trip.shipper_address && (
              <p className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                {trip.shipper_address}
              </p>
            )}
            {trip.shipper_phone && <p>📞 {trip.shipper_phone}</p>}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-[#0A2B4E] border-l-2 border-[#27AE60] pl-2 mb-3">
            Destinatar
          </h3>
          <div className="space-y-2 text-sm text-slate-600">
            <p className="font-medium text-slate-800">{trip.consignee_name}</p>
            {trip.consignee_address && (
              <p className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                {trip.consignee_address}
              </p>
            )}
            {trip.consignee_phone && <p>📞 {trip.consignee_phone}</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm text-center">
          <Truck className="w-5 h-5 text-slate-400 mx-auto mb-1" />
          <p className="text-xs text-slate-400">Vehicul</p>
          <p className="text-sm font-medium text-slate-700">{trip.vehicle_plate || '-'}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm text-center">
          <User className="w-5 h-5 text-slate-400 mx-auto mb-1" />
          <p className="text-xs text-slate-400">Șofer</p>
          <p className="text-sm font-medium text-slate-700">{trip.driver_name || '-'}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm text-center">
          <Package className="w-5 h-5 text-slate-400 mx-auto mb-1" />
          <p className="text-xs text-slate-400">Marfă</p>
          <p className="text-sm font-medium text-slate-700">
            {trip.weight_kg ? trip.weight_kg + ' kg' : '-'}
            {trip.package_count ? ` · ${trip.package_count} colete` : ''}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm text-center">
          <MapPin className="w-5 h-5 text-slate-400 mx-auto mb-1" />
          <p className="text-xs text-slate-400">Încărcare</p>
          <p className="text-sm font-medium text-slate-700">{formatDate(trip.loading_date)}</p>
        </div>
      </div>

      {/* OCR / Document */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-5 border-b border-slate-100">
          <FileText className="w-5 h-5 text-[#1D4E89]" />
          <h2 className="font-semibold text-[#0A2B4E]">Document CMR & OCR</h2>
          {doc?.is_confirmed && (
            <span className="ml-auto flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle className="w-3.5 h-3.5" /> OCR verificat
            </span>
          )}
        </div>
        <div className="p-5 space-y-4">
          {!doc?.original_image_url ? (
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl py-12 cursor-pointer hover:border-[#1D4E89] hover:bg-slate-50 transition-colors">
              {uploading ? (
                <>
                  <Loader2 className="w-8 h-8 text-[#1D4E89] animate-spin mb-2" />
                  <p className="text-sm text-slate-500">Se încarcă imaginea...</p>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-slate-400 mb-2" />
                  <p className="text-sm text-slate-500">Încarcă poza CMR</p>
                  <p className="text-xs text-slate-400 mt-1">JPG, PNG · OCR rulează automat după upload</p>
                </>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <img
                  src={doc.original_image_url}
                  alt="CMR"
                  className="w-full rounded-lg border border-slate-200 max-h-96 object-contain bg-slate-50"
                />
                <label className="mt-2 flex items-center justify-center gap-2 w-full px-4 py-2 text-xs font-medium text-[#1D4E89] bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100">
                  <Upload className="w-3.5 h-3.5" /> Reîncarcă imaginea
                  <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                </label>
              </div>
              <div className="space-y-3">
                {ocrProcessing ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 text-[#1D4E89] animate-spin mb-2" />
                    <p className="text-sm text-slate-500">Procesare OCR...</p>
                  </div>
                ) : hasOcrData ? (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Date extrase OCR
                    </h4>
                    {ocr._stub && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        {ocr._note || 'OCR stub: date precompletate din cursă.'}
                      </p>
                    )}
                    {!ocr._stub && ocr._provider === 'google_vision' && (
                      <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                        Extras cu Google Vision — verifică și confirmă datele.
                      </p>
                    )}
                    {[
                      { label: 'Număr CMR', value: ocr.cmr_number },
                      { label: 'Dată', value: ocr.date },
                      { label: 'Expeditor', value: ocr.shipper },
                      { label: 'Destinatar', value: ocr.consignee },
                      { label: 'Descriere marfă', value: ocr.goods_description },
                      { label: 'Greutate', value: ocr.weight },
                      { label: 'Colete', value: ocr.packages },
                    ].map((f, i) => (
                      <div key={i} className="flex justify-between gap-3 py-1.5 border-b border-slate-50">
                        <span className="text-xs text-slate-400">{f.label}</span>
                        <span className="text-sm font-medium text-slate-700 text-right">{f.value || '-'}</span>
                      </div>
                    ))}
                    {!doc.is_confirmed && (
                      <button
                        onClick={confirmOCR}
                        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-white bg-[#27AE60] rounded-lg hover:bg-emerald-600 transition-colors mt-3"
                      >
                        <CheckCircle className="w-4 h-4" /> Confirmă datele OCR
                      </button>
                    )}
                    <button
                      onClick={() => runOCR(doc.id, doc.original_image_url)}
                      className="w-full px-4 py-2 text-xs font-medium text-[#1D4E89] bg-blue-50 rounded-lg hover:bg-blue-100"
                    >
                      Rulează din nou OCR
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-slate-500 mb-3">Datele OCR nu au fost extrase încă</p>
                    <button
                      onClick={() => runOCR(doc.id, doc.original_image_url)}
                      className="px-4 py-2 text-sm font-medium text-white bg-[#1D4E89] rounded-lg hover:bg-[#0A2B4E]"
                    >
                      Rulează OCR
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Client confirmation */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-5 border-b border-slate-100">
          <Send className="w-5 h-5 text-[#F5A623]" />
          <h2 className="font-semibold text-[#0A2B4E]">Confirmare recepție client</h2>
        </div>
        <div className="p-5 space-y-4">
          {confirmation ? (
            <>
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    confirmation.status === 'confirmed' ? 'bg-emerald-100' : 'bg-amber-100'
                  }`}
                >
                  {confirmation.status === 'confirmed' ? (
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    Status: {confirmation.status === 'confirmed' ? 'Confirmat' : 'În așteptare'}
                  </p>
                  <p className="text-xs text-slate-500">Client: {confirmation.client_name}</p>
                  {confirmation.confirmed_at && (
                    <p className="text-xs text-slate-400">
                      Confirmat la: {new Date(confirmation.confirmed_at).toLocaleString('ro-RO')}
                    </p>
                  )}
                </div>
              </div>

              {clientLink && confirmation.status !== 'confirmed' && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Link securizat (valabil 30 zile)
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      readOnly
                      value={clientLink}
                      className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                    />
                    <button
                      onClick={copyLink}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89]"
                    >
                      <Copy className="w-4 h-4" />
                      {copied ? 'Copiat!' : 'Copiază'}
                    </button>
                    <a
                      href={clientLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-[#1D4E89] bg-blue-50 rounded-lg hover:bg-blue-100"
                    >
                      <ExternalLink className="w-4 h-4" /> Deschide
                    </a>
                  </div>
                  <p className="text-xs text-slate-400">
                    Email-ul e stub în MVP — copiază linkul și trimite-l manual clientului.
                  </p>
                </div>
              )}

              {confirmation.observations && (
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-400 mb-1">Observații client:</p>
                  <p className="text-sm text-slate-700">{confirmation.observations}</p>
                </div>
              )}

              {confirmation.status !== 'confirmed' && (
                <button
                  onClick={sendClientLink}
                  disabled={sendingLink}
                  className="text-xs font-medium text-[#1D4E89] hover:underline"
                >
                  Regenerează / reafișează link
                </button>
              )}
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-slate-500 mb-3">
                Generează un link securizat pentru destinatar — confirmă recepția fără cont.
              </p>
              <button
                onClick={sendClientLink}
                disabled={sendingLink}
                className="flex items-center gap-2 mx-auto px-5 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] disabled:opacity-50 transition-colors"
              >
                {sendingLink ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Se generează...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" /> Generează link client
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
