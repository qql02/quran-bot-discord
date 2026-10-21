# Third-party notices — Mushaf page images

The page pictures (Hafs `hafs-kfqc`, Warsh `warsh-kfqc`) are the **original, unmodified SVG files** published by
[quran.ws / quran-svg](https://github.com/quran-ws/quran-svg), release `v1.1.1`
(`https://cdn.quran.ws/svg/pages/v1.1.1/…`). The bot only downloads them and converts a page to PNG for display;
nothing is generated, re-typed or altered.

- **Artwork:** Madinah Mushaf by the **King Fahd Glorious Qur'an Printing Complex** (مجمع الملك فهد لطباعة المصحف الشريف).
  The Complex allows free use in software, websites, digital publishing and media. Only *printing for commercial sale*
  is reserved to it (<https://qurancomplex.gov.sa>). All rights in the edition remain with the Complex.
- **quran.ws metadata / structure:** CC BY 4.0, attribution waived for use inside a bot/product
  (see `NOTICE.md` and `LICENSE` in the quran-svg repository). The embed footer credits the Complex and quran.ws anyway.
- **@resvg/resvg-js** (SVG → PNG): MPL-2.0.
- The Quran text must never be altered or misrepresented — the pictures are shown exactly as published.

The downloaded files live in `assets/quran-images/` (not part of this package; re-created at start-up).
