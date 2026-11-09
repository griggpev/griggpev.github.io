// Random photo for the About section. File extensions are listed instead of
// probed, so only one image loads. An entry with `frames` is one picture
// split over several files. Captions are optional and can include links.
//
// To add a photo: put N.jpeg in bio-photos/ and add { n: N, caption } below.
(() => {
  'use strict';

  const DIR = 'bio-photos/';

  const BIO_PHOTOS = [
    { n: 1,  caption: 'Cannon Beach, Oregon.' },
    { n: 2,  caption: 'Portland, Oregon and her Mount Hood.' },
    { n: 3,  caption: 'The Blue Bridge, Reed College.' },
    { n: 4,  caption: 'Daily maintenance in Oregon’s High Desert.' },
    { n: 5,  caption: '<a href="https://www.portlandsocietyforcalligraphy.org/resources/weathergrams/">Weathergrams</a> introduced by Lloyd Reynolds.' },
    { n: 6 },
    { n: 7,  caption: 'Spatz was with us for 21 years.' },
    { n: 8,  caption: 'Worthwhile food poisoning.' },
    { n: 9,  caption: 'The reason for the sign and the sign.' },
    { n: 10 },
    { n: 11, caption: 'A fondness for street cats.' },
    { n: 12, caption: 'Barefoot backpacking across Oregon, 2019.' },
    { n: 13, caption: 'Our reunion after 6 years.' },
    { n: 14, caption: 'Mount Tabor, Portland, Oregon.' },
    { n: 15, caption: 'My favorite bird, the bearded vulture.' },
    { n: 16, caption: 'Me and Doc Kane.' },
    { n: 17 },
    { n: 18, caption: 'Polyhedral scribblings.' },
    { n: 19, caption: 'NSMRP 2025.' },
    { n: 20 },
    { n: 21 },
    { n: 22, caption: 'DRP Spring 2026.' },
    { n: 23, caption: 'Luna was feral when we found her.' },
    { n: 24, caption: 'Chatty Tipper.' },
    { n: 25, caption: 'Pulling plastic pockets.' },
    { n: 26, caption: 'It’s in the ankle.' },
    { n: 27 },
    { n: 28, caption: 'A 2,500 year-old Etruscan dodecahedron makes an appearance in Disney’s Andor.' },
    { n: 29, ext: 'png', caption: 'The affine group AGL(1,\u00a08) realizes a chiral map.' },
    { frames: [30, 31, 32], alt: 'Luna settling into the grass' },
  ];

  const init = () => {
    const container = document.querySelector('.bio-photo .frames');
    if (!container) { return; }

    const pick = BIO_PHOTOS[Math.floor(Math.random() * BIO_PHOTOS.length)];
    const frames = pick.frames || [pick.n];
    const ext = pick.ext || 'jpeg';

    container.classList.toggle('is-sequence', frames.length > 1);
    container.replaceChildren(...frames.map((n, i) => {
      const img = document.createElement('img');
      img.src = `${DIR}${n}.${ext}`;
      img.decoding = 'async';
      // Only the first frame of a sequence gets alt text.
      img.alt = i === 0 ? (pick.alt || pick.caption?.replace(/<[^>]+>/g, '') || 'Evan Angelone') : '';
      return img;
    }));

    const caption = document.querySelector('.bio-photo .cap');
    if (caption) { caption.innerHTML = pick.caption || ''; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
