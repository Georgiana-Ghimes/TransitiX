import React from "react";
import { formatAppVersion } from "@/lib/appVersion";
import { logoColor } from "@/components/BrandLogo";

export default function AuthLayout({ icon: Icon, brandLogo = false, title, subtitle, footer = null, children }) {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md min-w-0">
        <div className="text-center mb-6 sm:mb-10">
          {brandLogo ? (
            <img
              src={logoColor}
              alt="Transitix"
              className="h-12 sm:h-14 w-auto max-w-[min(100%,18rem)] mx-auto mb-4 object-contain"
            />
          ) : Icon ? (
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
              <Icon className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
            </div>
          ) : null}
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2 text-sm sm:text-base">{subtitle}</p>}
        </div>
        <div className="bg-card rounded-2xl shadow-sm border border-border p-5 sm:p-8">
          {children}
          <p
            className="text-center text-xs text-muted-foreground/80 mt-6 tabular-nums"
            title="Versiune aplicație"
          >
            {formatAppVersion()}
          </p>
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}
