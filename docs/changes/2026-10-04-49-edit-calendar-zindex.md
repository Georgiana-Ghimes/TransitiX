#49 Editează: calendar icon did not open the picker

`RoDateField` uses a Radix Popover portaled to `document.body` at `z-50`.
`ModalShell` is `z-[100]`, so the calendar opened behind the dim overlay.

Popover content is now `z-[200]` (opaque white). Escape on an open picker
does not close the whole modal (`defaultPrevented`).
