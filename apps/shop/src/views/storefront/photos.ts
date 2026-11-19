import { html, type SafeHtml } from "@agentdoor/ui";

/**
 * The licensed Pexels photos in public/photos (see CREDITS.md there). They are illustrative and do not
 * show the shop's own bakes, so the alt text describes what is pictured and claims nothing more.
 * Width and height are the files' real pixel sizes: the browser reserves the space, so nothing jumps.
 */
export interface Photo {
  file: string;
  width: number;
  height: number;
  alt: string;
}

const photo = (file: string, width: number, height: number, alt: string): Photo => ({ file, width, height, alt });

export const HERO_PHOTO = photo(
  "hero-chocolate-cake.jpg",
  800,
  1200,
  "A chocolate cake dusted with cocoa and ringed with toasted almond flakes, one slice cut out, on a blue-striped cloth beside a cup of tea.",
);

export const KITCHEN_PHOTOS = [
  photo("kitchen-sifting-flour.jpg", 800, 1200, "Hands sifting flour through a fine sieve into a cream mixing bowl on a sunlit kitchen counter."),
  photo("kitchen-flour-hands.jpg", 1200, 800, "A baker in a striped apron dusting flour from both hands over a bowl, with eggs and fresh greens nearby."),
];

export const OCCASION_PHOTOS: Record<"birthday" | "gifting" | "anniversary", Photo> = {
  birthday: photo("occasion-birthday.jpg", 959, 1200, "A birthday cake ringed with lit golden letter candles spelling happy birthday, glowing in a dark room."),
  gifting: photo("occasion-gifting.jpg", 800, 1200, "A stack of dark chocolate brownies topped with walnuts and pomegranate seeds."),
  anniversary: photo("occasion-anniversary.jpg", 1200, 800, "A small plate of oat cookies beside an almond-topped braided sweet bread on a festive table with gold-rimmed plates."),
};

/** Product photos by catalog id. A product without one simply shows a soft colour panel instead. */
export const PRODUCT_PHOTOS: Record<string, Photo> = {
  "chocolate-cake": photo("chocolate-cake.jpg", 800, 1200, "A forkful of moist, layered chocolate cake on a pale ceramic plate."),
  "eggless-vanilla-cake": photo("eggless-vanilla-cake.jpg", 800, 1200, "A vanilla layer cake topped with cream swirls, seen from above with a slice and a fork on a second plate."),
  "cookie-box": photo("cookie-box.jpg", 1200, 800, "A pile of chunky chocolate cookies resting on crumpled baking paper."),
  brownies: photo("brownies.jpg", 1200, 900, "A stack of fudgy chocolate-chip brownies on a plate, scattered with fresh raspberries."),
};

/**
 * A product whose id is not one of the four above (a draft built from the owner's own words) gets the
 * photo of its kind: the most specific word wins, and anything else shows the hero cake.
 */
export function productPhotoFor(item: { id: string; name: { en: string } }): Photo {
  const known = PRODUCT_PHOTOS[item.id];
  if (known) return known;
  const words = `${item.id} ${item.name.en}`.toLowerCase();
  if (/cookie|biscuit/.test(words)) return PRODUCT_PHOTOS["cookie-box"]!;
  if (/brownie/.test(words)) return PRODUCT_PHOTOS.brownies!;
  if (/vanilla|eggless/.test(words)) return PRODUCT_PHOTOS["eggless-vanilla-cake"]!;
  if (/cake|chocolate/.test(words)) return PRODUCT_PHOTOS["chocolate-cake"]!;
  return HERO_PHOTO;
}

const PHOTO_DIR = "/assets/photos";

interface ImgOptions {
  /** Only the hero image is eager and high priority; everything below the fold is lazy. */
  hero?: boolean;
  className?: string;
}

export function photoImg(p: Photo, o: ImgOptions = {}): SafeHtml {
  const loading = o.hero ? html`fetchpriority="high"` : html`loading="lazy" decoding="async"`;
  return html`<img class="${o.className ?? "photo"}" src="${PHOTO_DIR}/${p.file}" width="${p.width}" height="${p.height}" alt="${p.alt}" ${loading}>`;
}
