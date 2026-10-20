import OfficeTourDesktop from './OfficeTourDesktop';
import OfficeTourMobile from './OfficeTourMobile';

/** Picks desktop coach panel vs mobile bottom sheet (Layout passes isDesktop). */
export default function OfficeTour({ isDesktop, step, steps, onStepChange, onClose }) {
  if (isDesktop) {
    return (
      <OfficeTourDesktop step={step} steps={steps} onStepChange={onStepChange} onClose={onClose} />
    );
  }
  return (
    <OfficeTourMobile step={step} steps={steps} onStepChange={onStepChange} onClose={onClose} />
  );
}
