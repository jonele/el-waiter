
## 2026-03-06 — Zero-Friction UI Overhaul (Tables + Order Builder)
- **brand** color → #3B82F6 (vibrant blue, was navy); **accent** → #10B981 (emerald for pay)
- **touch-btn** → min 60px (was 48px), per Zero-Friction mandate
- **Tables page**: glassmorphism header, pulsing status dots (no text labels), emerald/blue/amber card bg, bottom nav, scale-90 press, logout removed from header
- **Order Builder**: seat-based ordering workaround — global active-seat picker in sub-bar; items tagged with seat#; cart view groups by seat. Eve to build KDS seat display.
- **BottomNav** component: fixed bottom 3-tab nav (Τραπέζια / Πορτοφόλι / Ρυθμίσεις)
- **Upsell**: converted from center modal → bottom sheet (iOS pattern)
- **Πληρωμή** button: green accent pill (was plain text link)
- +/- cart buttons: 44px → w-11 h-11 (44px, full circle)
- slideUp + pulse-fast keyframes added to globals.css
