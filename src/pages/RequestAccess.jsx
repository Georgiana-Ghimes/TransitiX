import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Loader2, Mail, Phone, User } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import { APP_PROFILES } from '@/lib/platformFlags';
import { friendlyErrorMessage } from '@/lib/notify';

export default function RequestAccess() {
  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    message: '',
    preferred_profile: 'full',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.public.requestAccess(form);
      setDone(true);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthLayout
        brandLogo
        title="Cerere înregistrată"
        subtitle="Te contactăm pentru setup — fără self-signup pe platformă."
        footer={(
          <Link to="/login" className="text-primary font-medium hover:underline">
            Înapoi la autentificare
          </Link>
        )}
      >
        <p className="text-sm text-slate-600 text-center leading-relaxed">
          Mulțumim. Echipa Transitix îți configurează firma și îți trimite invitația de acces.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      brandLogo
      title="Solicită acces"
      subtitle="Completează detaliile — te contactăm pentru configurarea firmei."
      footer={(
        <>
          Ai deja cont?{' '}
          <Link to="/login" className="text-primary font-medium hover:underline">
            Autentifică-te
          </Link>
        </>
      )}
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="company_name">Nume firmă</Label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="company_name"
              value={form.company_name}
              onChange={setField('company_name')}
              className="pl-10 h-11"
              required
              minLength={2}
              placeholder="SC Exemplu SRL"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact_name">Persoană de contact</Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="contact_name"
              value={form.contact_name}
              onChange={setField('contact_name')}
              className="pl-10 h-11"
              required
              minLength={2}
              placeholder="Ion Popescu"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={setField('email')}
              className="pl-10 h-11"
              required
              placeholder="ion@exemplu.ro"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Telefon <span className="text-muted-foreground font-normal">(opțional)</span></Label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="phone"
              type="tel"
              value={form.phone}
              onChange={setField('phone')}
              className="pl-10 h-11"
              placeholder="+40 …"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Tip produs preferat</Label>
          <div className="grid grid-cols-1 gap-2">
            {Object.values(APP_PROFILES).map((p) => {
              const active = form.preferred_profile === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, preferred_profile: p.key }))}
                  className={`text-left rounded-lg border p-3 transition-colors ${
                    active ? 'border-primary bg-primary/5' : 'border-border hover:border-slate-300'
                  }`}
                >
                  <p className="text-sm font-medium">{p.shortLabel}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="message">Mesaj <span className="text-muted-foreground font-normal">(opțional)</span></Label>
          <textarea
            id="message"
            value={form.message}
            onChange={setField('message')}
            rows={3}
            className="w-full text-sm border border-input rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Câteva cuvinte despre nevoi / flotă…"
          />
        </div>

        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Se trimite…
            </>
          ) : (
            'Trimite cererea'
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
