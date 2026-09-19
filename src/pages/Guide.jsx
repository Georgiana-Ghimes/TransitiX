import React from 'react';
import { useAuth } from '@/lib/AuthContext';
import { isDocumentsProfile } from '@/lib/appProfile';
import { guideFor } from '@/lib/guide';
import GuideView from '@/components/GuideView';
import { PlayCircle } from 'lucide-react';
import { OFFICE_TOUR_SEEN_KEY } from '@/lib/officeTour';

/**
 * The office guide screen.
 *
 * The guided tour is offered from here rather than from the sidebar, so there is one place to
 * go when you do not know something. Two entry points labelled Ghid, one opening an overlay
 * and one opening a page, is a coin flip the reader has to lose before learning the difference.
 */
export default function Guide() {
  const { user } = useAuth();
  const companion = isDocumentsProfile();
  const guide = guideFor({ role: user?.role, companion });

  const replayTour = () => {
    try {
      localStorage.removeItem(OFFICE_TOUR_SEEN_KEY);
    } catch {
      // Private mode: the tour simply will not be remembered, which is the same as replaying it.
    }
    window.location.assign('/');
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <GuideView
        guide={guide}
        header={companion ? null : (
          <button
            type="button"
            onClick={replayTour}
            className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#0A2B4E] hover:bg-slate-50"
          >
            <PlayCircle className="h-4 w-4" />
            Reia turul ghidat
          </button>
        )}
      />
    </div>
  );
}
