export type Need = 'commute' | 'small-space' | 'unplug' | 'gift';
export type ProductCategory = 'bags' | 'audio' | 'clothing' | 'home';
export type ScopeMode = 'all' | 'wear' | 'home' | 'audio';

export type Product = {
  id: string;
  name: string;
  maker: string;
  merchant: string;
  category: ProductCategory;
  priceMinor: number;
  deliveryDays: number;
  returnDays: number;
  truthScore: number;
  qualityScore: number;
  image: string;
  imagePosition: string;
  proof: [string, string];
  needScores: Record<Need, number>;
};

export const SCOPE_CATEGORIES: Record<ScopeMode, readonly ProductCategory[]> = {
  all: ['bags', 'audio', 'clothing', 'home'],
  wear: ['bags', 'clothing'],
  home: ['home'],
  audio: ['audio'],
};

export const NEED_SLUG: Record<Need, string> = {
  commute: 'rain-ready-commute',
  'small-space': 'small-space-reset',
  unplug: 'quieter-evening',
  gift: 'gift-under-75',
};

export const NEEDS: Array<{
  id: Need;
  label: string;
  heading: string;
  budgetMinor: number;
  heroImage: string;
  heroAlt: string;
  heroPosition: string;
}> = [
  { id: 'commute', label: 'Rain-ready commute', heading: 'Ready before the weather changes.', budgetMinor: 15_000, heroImage: '/commerce/commute-hero.webp', heroAlt: 'A commuter in a waterproof shell carrying a cobalt backpack through London after rain', heroPosition: 'center' },
  { id: 'small-space', label: 'Small-space reset', heading: 'More room without moving house.', budgetMinor: 8_000, heroImage: '/commerce/home-hero.webp', heroAlt: 'A compact apartment with an organized desk and space-saving products', heroPosition: 'center' },
  { id: 'unplug', label: 'A quieter evening', heading: 'Switch off without disappearing.', budgetMinor: 13_000, heroImage: '/commerce/home-hero.webp', heroAlt: 'A calm compact apartment prepared for a quieter evening', heroPosition: 'center' },
  { id: 'gift', label: 'Gift under £75', heading: 'Useful enough to keep.', budgetMinor: 7_500, heroImage: '/commerce/home-hero.webp', heroAlt: 'Colorful useful home products in a compact apartment', heroPosition: 'center' },
];

export const PRODUCTS: Product[] = [
  {
    id: 'tidepack-commuter', name: 'Tidepack Commuter', maker: 'Recycled waterproof shell', merchant: 'Northline Goods', category: 'bags',
    priceMinor: 9600, deliveryDays: 2, returnDays: 45, truthScore: 98, qualityScore: 91,
    image: '/commerce/commute-products.webp', imagePosition: '0% 50%', proof: ['16-inch laptop stays dry', 'Reflective after dark'],
    needScores: { commute: 97, 'small-space': 55, unplug: 48, gift: 77 },
  },
  {
    id: 'hush-45', name: 'Hush 45', maker: 'Adaptive over-ear headphones', merchant: 'Aster Audio', category: 'audio',
    priceMinor: 12900, deliveryDays: 2, returnDays: 30, truthScore: 96, qualityScore: 94,
    image: '/commerce/commute-products.webp', imagePosition: '50% 50%', proof: ['Quiet mode in one tap', '32-hour battery'],
    needScores: { commute: 91, 'small-space': 62, unplug: 96, gift: 74 },
  },
  {
    id: 'mossline-shell', name: 'Mossline Shell', maker: 'Recycled three-layer weave', merchant: 'Field & Form', category: 'clothing',
    priceMinor: 8900, deliveryDays: 2, returnDays: 60, truthScore: 99, qualityScore: 93,
    image: '/commerce/commute-products.webp', imagePosition: '100% 50%', proof: ['Sealed seams', 'Packs into its hood'],
    needScores: { commute: 95, 'small-space': 43, unplug: 57, gift: 69 },
  },
  {
    id: 'beam-mini', name: 'Beam Mini', maker: 'Warm dimmable task light', merchant: 'Common Object', category: 'home',
    priceMinor: 4600, deliveryDays: 3, returnDays: 30, truthScore: 94, qualityScore: 89,
    image: '/commerce/home-products.webp', imagePosition: '0% 50%', proof: ['17 cm footprint', 'Warm focus light'],
    needScores: { commute: 34, 'small-space': 96, unplug: 83, gift: 94 },
  },
  {
    id: 'stack-system', name: 'Stack System', maker: 'Modular recycled composite', merchant: 'Room Made', category: 'home',
    priceMinor: 6200, deliveryDays: 3, returnDays: 45, truthScore: 97, qualityScore: 92,
    image: '/commerce/home-products.webp', imagePosition: '50% 50%', proof: ['Builds upward', 'Tools not required'],
    needScores: { commute: 28, 'small-space': 98, unplug: 68, gift: 82 },
  },
  {
    id: 'dawn-halo', name: 'Dawn Halo', maker: 'Low-glare sunrise light', merchant: 'Good Morning Co.', category: 'home',
    priceMinor: 5400, deliveryDays: 2, returnDays: 30, truthScore: 95, qualityScore: 90,
    image: '/commerce/home-products.webp', imagePosition: '100% 50%', proof: ['Phone-free controls', 'Soft evening mode'],
    needScores: { commute: 31, 'small-space': 86, unplug: 93, gift: 91 },
  },
];
