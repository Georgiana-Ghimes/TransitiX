import OfficeTourDesktop from './OfficeTourDesktop';
import OfficeTourMobile from './OfficeTourMobile';

/** Picks desktop coach panel vs mobile bottom sheet (Layout passes isDesktop). */
export default function OfficeTour({ isDesktop, step, onStepChange, onClose }) {
  if (isDesktop) {
    return (
      <OfficeTourDesktop step={step} onStepChange={onStepChange} onClose={onClose} />
    );
  }
  return (
    <OfficeTourMobile step={step} onStepChange={onStepChange} onClose={onClose} />
  );
}
