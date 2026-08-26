import React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

/**
 * Catches a render error so one broken screen does not blank the whole app.
 *
 * Without this, a single null dereference in a `.map()` leaves the driver or the dispatcher
 * looking at white — no message, no way back, and nothing in the interface saying what happened.
 * React itself printed "Consider adding an error boundary" in this project's console before this
 * existed.
 *
 * Boundaries are placed twice: once per route inside the layout, so the sidebar survives and the
 * user can navigate away from the broken screen, and once around the whole app as a last resort.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Until there is real error reporting, the console is the only trail. Keep the component
    // stack: the message alone rarely says which screen died.
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info?.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps) {
    // A boundary that stays broken after the user navigates away is a dead end. Resetting on a
    // changed key lets the next route render normally.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, () => this.setState({ error: null }));

    return (
      <div className="p-6 flex justify-center">
        <div className="max-w-lg w-full bg-white rounded-xl border border-red-200 p-6 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <h2 className="text-base font-semibold text-slate-800">Ecranul acesta a crăpat</h2>
          </div>
          <p className="text-sm text-slate-600">
            Restul aplicației funcționează — poți naviga în altă parte din meniu. Nimic din ce ai
            salvat deja nu s-a pierdut.
          </p>
          <p className="text-xs text-slate-400 font-mono break-words">
            {error?.message || String(error)}
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-3 py-2 text-sm rounded-lg bg-[#1D4E89] text-white hover:bg-[#0A2B4E] inline-flex items-center gap-1.5 min-h-[38px]"
            >
              <RotateCw className="w-4 h-4" /> Încearcă din nou
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 min-h-[38px]"
            >
              Reîncarcă pagina
            </button>
          </div>
        </div>
      </div>
    );
  }
}
