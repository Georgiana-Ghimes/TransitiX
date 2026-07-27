import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from '@/api/client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, Loader2, Copy, ExternalLink } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [resetLink, setResetLink] = useState("");
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await api.auth.resetPasswordRequest(email);
      setResetLink(data?.reset_link || "");
    } catch {
      setResetLink("");
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  const copyLink = async () => {
    if (!resetLink) return;
    try {
      await navigator.clipboard.writeText(resetLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("Copiază linkul:", resetLink);
    }
  };

  return (
    <AuthLayout
      icon={Mail}
      title="Resetare parolă"
      subtitle="Îți trimitem un link de resetare"
      footer={
        <Link to="/login" className="text-primary font-medium hover:underline">
          <ArrowLeft className="w-3 h-3 inline mr-1" />Înapoi la autentificare
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <p className="text-sm text-foreground text-center">
            Dacă există un cont cu acest email, poți reseta parola folosind linkul de mai jos.
          </p>
          {resetLink ? (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-muted-foreground">
                Email nu e configurat încă — folosește linkul local:
              </p>
              <p className="text-xs break-all text-foreground">{resetLink}</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={copyLink}>
                  <Copy className="w-4 h-4 mr-1" />
                  {copied ? "Copiat" : "Copiază"}
                </Button>
                <Button type="button" className="flex-1" asChild>
                  <a href={resetLink}>
                    <ExternalLink className="w-4 h-4 mr-1" />
                    Deschide
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center">
              Verifică și adresa de email dacă nu vezi linkul.
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Adresă email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="tu@exemplu.ro"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-12"
                required
              />
            </div>
          </div>
          <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Se trimite...
              </>
            ) : (
              "Trimite link de resetare"
            )}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
