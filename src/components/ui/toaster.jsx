import { useToast } from "@/components/ui/use-toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProgress,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";

const TOAST_DURATION_MS = 3000;

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider swipeDirection="right">
      {toasts.map(({ id, title, description, action, duration = TOAST_DURATION_MS, ...props }) => (
        <Toast
          key={id}
          {...props}
          duration={Number.POSITIVE_INFINITY}
        >
          <div className="grid gap-1 min-w-0 flex-1">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          {action}
          <ToastClose />
          <ToastProgress duration={duration} />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
