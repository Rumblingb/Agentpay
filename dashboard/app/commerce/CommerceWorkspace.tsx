'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Code2,
  DatabaseZap,
  Gift,
  Headphones,
  Home,
  LockKeyhole,
  PackageCheck,
  Route,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Tag,
  Truck,
  Undo2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import styles from './commerce.module.css';

type Need = 'commute' | 'small-space' | 'unplug' | 'gift';
type Stage = 'review' | 'checkout' | 'receipt';

type Product = {
  id: string;
  name: string;
  maker: string;
  merchant: string;
  priceMinor: number;
  deliveryDays: number;
  returnDays: number;
  truthScore: number;
  image: string;
  imagePosition: string;
  proof: [string, string];
  needScores: Record<Need, number>;
};

const NEEDS: Array<{
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

const PRODUCTS: Product[] = [
  {
    id: 'tidepack-commuter',
    name: 'Tidepack Commuter',
    maker: 'Recycled waterproof shell',
    merchant: 'Northline Goods',
    priceMinor: 9600,
    deliveryDays: 2,
    returnDays: 45,
    truthScore: 98,
    image: '/commerce/commute-products.webp',
    imagePosition: '0% 50%',
    proof: ['16-inch laptop stays dry', 'Reflective after dark'],
    needScores: { commute: 97, 'small-space': 55, unplug: 48, gift: 77 },
  },
  {
    id: 'hush-45',
    name: 'Hush 45',
    maker: 'Adaptive over-ear headphones',
    merchant: 'Aster Audio',
    priceMinor: 12900,
    deliveryDays: 2,
    returnDays: 30,
    truthScore: 96,
    image: '/commerce/commute-products.webp',
    imagePosition: '50% 50%',
    proof: ['Quiet mode in one tap', '32-hour battery'],
    needScores: { commute: 91, 'small-space': 62, unplug: 96, gift: 74 },
  },
  {
    id: 'mossline-shell',
    name: 'Mossline Shell',
    maker: 'Recycled three-layer weave',
    merchant: 'Field & Form',
    priceMinor: 8900,
    deliveryDays: 2,
    returnDays: 60,
    truthScore: 99,
    image: '/commerce/commute-products.webp',
    imagePosition: '100% 50%',
    proof: ['Sealed seams', 'Packs into its hood'],
    needScores: { commute: 95, 'small-space': 43, unplug: 57, gift: 69 },
  },
  {
    id: 'beam-mini',
    name: 'Beam Mini',
    maker: 'Warm dimmable task light',
    merchant: 'Common Object',
    priceMinor: 4600,
    deliveryDays: 3,
    returnDays: 30,
    truthScore: 94,
    image: '/commerce/home-products.webp',
    imagePosition: '0% 50%',
    proof: ['17 cm footprint', 'Warm focus light'],
    needScores: { commute: 34, 'small-space': 96, unplug: 83, gift: 94 },
  },
  {
    id: 'stack-system',
    name: 'Stack System',
    maker: 'Modular recycled composite',
    merchant: 'Room Made',
    priceMinor: 6200,
    deliveryDays: 3,
    returnDays: 45,
    truthScore: 97,
    image: '/commerce/home-products.webp',
    imagePosition: '50% 50%',
    proof: ['Builds upward', 'Tools not required'],
    needScores: { commute: 28, 'small-space': 98, unplug: 68, gift: 82 },
  },
  {
    id: 'dawn-halo',
    name: 'Dawn Halo',
    maker: 'Low-glare sunrise light',
    merchant: 'Good Morning Co.',
    priceMinor: 5400,
    deliveryDays: 2,
    returnDays: 30,
    truthScore: 95,
    image: '/commerce/home-products.webp',
    imagePosition: '100% 50%',
    proof: ['Phone-free controls', 'Soft evening mode'],
    needScores: { commute: 31, 'small-space': 86, unplug: 93, gift: 91 },
  },
];

const NEED_ICON = {
  commute: Route,
  'small-space': Home,
  unplug: Headphones,
  gift: Gift,
} satisfies Record<Need, typeof Route>;

function money(amountMinor: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amountMinor / 100);
}

function mandateId(product: Product) {
  return `choice_demo_${product.id.replaceAll('-', '_')}`;
}

export default function CommerceWorkspace() {
  const [need, setNeed] = useState<Need>('commute');
  const [budgetMinor, setBudgetMinor] = useState(15_000);
  const [maxDeliveryDays, setMaxDeliveryDays] = useState(3);
  const [easyReturns, setEasyReturns] = useState(true);
  const [selectedId, setSelectedId] = useState('tidepack-commuter');
  const [approved, setApproved] = useState(false);
  const [stage, setStage] = useState<Stage>('review');
  const [apiOpen, setApiOpen] = useState(false);

  const needConfig = NEEDS.find((item) => item.id === need) ?? NEEDS[0];
  const ranked = useMemo(() => PRODUCTS
    .filter((product) => product.priceMinor <= budgetMinor)
    .filter((product) => product.deliveryDays <= maxDeliveryDays)
    .filter((product) => !easyReturns || product.returnDays >= 30)
    .filter((product) => product.needScores[need] >= 50)
    .sort((a, b) => b.needScores[need] - a.needScores[need]), [budgetMinor, easyReturns, maxDeliveryDays, need]);
  const selected = ranked.find((product) => product.id === selectedId) ?? ranked[0] ?? PRODUCTS[0];

  function resetApproval() {
    setApproved(false);
    setStage('review');
  }

  function chooseNeed(nextNeed: Need) {
    const nextConfig = NEEDS.find((item) => item.id === nextNeed) ?? NEEDS[0];
    const nextProduct = [...PRODUCTS].sort((a, b) => b.needScores[nextNeed] - a.needScores[nextNeed])[0];
    setNeed(nextNeed);
    setBudgetMinor(nextConfig.budgetMinor);
    setSelectedId(nextProduct.id);
    resetApproval();
  }

  function resetBrief() {
    setBudgetMinor(needConfig.budgetMinor);
    setMaxDeliveryDays(3);
    setEasyReturns(true);
    resetApproval();
  }

  return (
    <div className={styles.shell}>
      <section className={styles.hero}>
        <Image
          className={styles.heroImage}
          src={needConfig.heroImage}
          alt={needConfig.heroAlt}
          fill
          priority
          sizes="100vw"
          style={{ objectPosition: needConfig.heroPosition }}
        />
        <header className={styles.header}>
          <Link className={styles.brand} href="/commerce" aria-label="AgentPay Discover home">
            <ShieldCheck aria-hidden="true" />
            <span>AgentPay</span>
            <small>Discover</small>
          </Link>
          <nav aria-label="AgentPay commerce">
            <Link className={styles.navActive} href="/commerce"><ShoppingBag aria-hidden="true" /> Discover</Link>
            <Link href="/commerce/studio"><Store aria-hidden="true" /> Sell</Link>
          </nav>
          <button className={styles.headerButton} type="button" onClick={() => setApiOpen(true)} aria-label="Open developer API">
            <Code2 aria-hidden="true" /> <span>API</span>
          </button>
        </header>

        <div className={styles.heroCopy}>
          <p>AgentPay Discover</p>
          <h1>Shop the moment.<br />Not the category.</h1>
          <span>One brief. Honest matches. Merchant checkout.</span>
        </div>

        <div className={styles.needRail} aria-label="Choose what you need">
          {NEEDS.map((item) => {
            const Icon = NEED_ICON[item.id];
            return (
              <button
                className={item.id === need ? styles.needActive : styles.need}
                key={item.id}
                type="button"
                onClick={() => chooseNeed(item.id)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
                <ChevronRight aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>

      <main>
        <section className={styles.briefBand} aria-labelledby="brief-heading">
          <div className={styles.briefTitle}>
            <SlidersHorizontal aria-hidden="true" />
            <div><p>Your brief</p><h2 id="brief-heading">{needConfig.heading}</h2></div>
            <button type="button" onClick={resetBrief} aria-label="Reset shopping brief"><Undo2 aria-hidden="true" /></button>
          </div>

          <div className={styles.briefControls}>
            <label className={styles.rangeControl}>
              <span><CircleDollarSign aria-hidden="true" /> Budget <strong>{money(budgetMinor)}</strong></span>
              <input
                aria-label="Maximum budget"
                type="range"
                min="4000"
                max="20000"
                step="500"
                value={budgetMinor}
                onChange={(event) => { setBudgetMinor(Number(event.target.value)); resetApproval(); }}
              />
            </label>
            <div className={styles.segmentControl}>
              <span><Truck aria-hidden="true" /> Arrives</span>
              <div>
                {[2, 3, 5].map((days) => (
                  <button className={maxDeliveryDays === days ? styles.segmentActive : undefined} key={days} type="button" onClick={() => { setMaxDeliveryDays(days); resetApproval(); }}>{days}d</button>
                ))}
              </div>
            </div>
            <label className={styles.toggleControl}>
              <span><PackageCheck aria-hidden="true" /> 30+ day returns</span>
              <input type="checkbox" checked={easyReturns} onChange={(event) => { setEasyReturns(event.target.checked); resetApproval(); }} />
              <i aria-hidden="true"><b /></i>
            </label>
          </div>
        </section>

        <section className={styles.results} aria-labelledby="results-heading">
          <div className={styles.resultsHeader}>
            <div><p>{ranked.length} verified matches</p><h2 id="results-heading">Best fit first</h2></div>
            <div className={styles.rankingKey}><BadgeCheck aria-hidden="true" /><span>Sponsored never changes fit score</span></div>
          </div>

          <div className={styles.resultsGrid}>
            <div className={styles.productGrid}>
              {ranked.length ? ranked.map((product) => {
                const isSelected = product.id === selected.id;
                return (
                  <button
                    className={isSelected ? styles.productActive : styles.product}
                    key={product.id}
                    type="button"
                    onClick={() => { setSelectedId(product.id); resetApproval(); }}
                    aria-pressed={isSelected}
                  >
                    <span className={styles.productVisual}>
                      <Image src={product.image} alt={product.name} fill sizes="(max-width: 760px) 100vw, 33vw" style={{ objectFit: 'cover', objectPosition: product.imagePosition }} />
                      <strong>{product.needScores[need]}<small>% fit</small></strong>
                      {product.truthScore >= 97 ? <i><BadgeCheck aria-hidden="true" /> Truth checked</i> : null}
                    </span>
                    <span className={styles.productBody}>
                      <span className={styles.productMeta}><small>{product.merchant}</small><strong>{money(product.priceMinor)}</strong></span>
                      <span className={styles.productName}>{product.name}</span>
                      <span className={styles.proofRow}>
                        <span><Check aria-hidden="true" />{product.proof[0]}</span>
                        <span><Truck aria-hidden="true" />{product.deliveryDays} days</span>
                      </span>
                    </span>
                  </button>
                );
              }) : (
                <div className={styles.emptyState}>
                  <ShoppingBag aria-hidden="true" />
                  <h3>No honest match yet</h3>
                  <p>Raise the budget or delivery window. AgentPay will not quietly ignore your brief.</p>
                  <button type="button" onClick={resetBrief}>Reset brief</button>
                </div>
              )}
            </div>

            <aside className={styles.choicePanel} aria-label="Selected product approval">
              {stage === 'review' ? (
                <>
                  <div className={styles.choiceTop}>
                    <span className={styles.choiceThumb}><Image src={selected.image} alt="" fill sizes="72px" style={{ objectFit: 'cover', objectPosition: selected.imagePosition }} /></span>
                    <div><p>Best current fit</p><h3>{selected.name}</h3><span>{selected.merchant}</span></div>
                    <strong>{selected.needScores[need]}%</strong>
                  </div>
                  <div className={styles.factGrid}>
                    <span><Tag aria-hidden="true" /><small>Total</small><strong>{money(selected.priceMinor)}</strong></span>
                    <span><Truck aria-hidden="true" /><small>Delivery</small><strong>{selected.deliveryDays} days</strong></span>
                    <span><PackageCheck aria-hidden="true" /><small>Returns</small><strong>{selected.returnDays} days</strong></span>
                    <span><DatabaseZap aria-hidden="true" /><small>Truth</small><strong>{selected.truthScore}/100</strong></span>
                  </div>
                  <div className={styles.choiceWhy}>
                    <p>Why it fits</p>
                    {selected.proof.map((item) => <span key={item}><CheckCircle2 aria-hidden="true" />{item}</span>)}
                  </div>
                  <label className={styles.approval}>
                    <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
                    <i aria-hidden="true"><Check /></i>
                    <span>I approve this exact item and total.</span>
                  </label>
                  <button className={styles.primaryAction} type="button" disabled={!approved} onClick={() => setStage('checkout')}>
                    Review merchant checkout <ArrowRight aria-hidden="true" />
                  </button>
                  <p className={styles.sandboxNote}><LockKeyhole aria-hidden="true" /> Sandbox only. No payment details requested.</p>
                </>
              ) : null}

              {stage === 'checkout' ? (
                <div className={styles.checkoutState}>
                  <div className={styles.checkoutBrand}><Store aria-hidden="true" /><span>{selected.merchant}</span><small>Sandbox checkout</small></div>
                  <span className={styles.checkoutProduct}><Image src={selected.image} alt="" fill sizes="96px" style={{ objectFit: 'cover', objectPosition: selected.imagePosition }} /></span>
                  <h3>{selected.name}</h3>
                  <div><span>Item</span><strong>{money(selected.priceMinor)}</strong></div>
                  <div><span>Delivery</span><strong>Included</strong></div>
                  <div className={styles.checkoutTotal}><span>Total</span><strong>{money(selected.priceMinor)}</strong></div>
                  <button className={styles.primaryAction} type="button" onClick={() => setStage('receipt')}>Complete sandbox order <ArrowRight aria-hidden="true" /></button>
                  <button className={styles.textAction} type="button" onClick={() => setStage('review')}>Back to match</button>
                </div>
              ) : null}

              {stage === 'receipt' ? (
                <div className={styles.receiptState}>
                  <CheckCircle2 aria-hidden="true" />
                  <p>Sandbox complete</p>
                  <h3>Choice confirmed.</h3>
                  <span>No payment was taken.</span>
                  <div><small>Choice receipt</small><code>{mandateId(selected)}</code></div>
                  <div><small>Merchant</small><strong>{selected.merchant}</strong></div>
                  <div><small>Approved total</small><strong>{money(selected.priceMinor)}</strong></div>
                  <button className={styles.primaryAction} type="button" onClick={() => { setApproved(false); setStage('review'); }}>Explore again</button>
                </div>
              ) : null}
            </aside>
          </div>
        </section>

        <section className={styles.sellerBand}>
          <div><p>For independent merchants</p><h2>Sell where demand already exists.</h2></div>
          <div className={styles.sellerSignals}>
            <span><Route aria-hidden="true" /> See unmet needs</span>
            <span><DatabaseZap aria-hidden="true" /> Fix catalog drift</span>
            <span><CircleDollarSign aria-hidden="true" /> Pay after a verified sale</span>
          </div>
          <Link href="/commerce/studio">Open seller studio <ArrowRight aria-hidden="true" /></Link>
        </section>
      </main>

      {apiOpen ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={() => setApiOpen(false)}>
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="api-heading" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <div><p>AgentPay API + MCP</p><h2 id="api-heading">Discover by need</h2></div>
              <button type="button" onClick={() => setApiOpen(false)} aria-label="Close API preview"><X aria-hidden="true" /></button>
            </div>
            <code>POST /api/commerce/discover</code>
            <pre>{`{
  "need": "rain-ready-commute",
  "budgetMinor": 15000,
  "currency": "GBP",
  "maxDeliveryDays": 3,
  "minReturnDays": 30
}`}</pre>
            <div className={styles.apiFacts}>
              <span><ShieldCheck aria-hidden="true" /> Hard constraints stay deterministic</span>
              <span><BadgeCheck aria-hidden="true" /> Sponsorship is disclosed, never blended</span>
              <span><CalendarCheck aria-hidden="true" /> Catalog evidence expires</span>
            </div>
            <Link href="/docs">Developer docs <ChevronRight aria-hidden="true" /></Link>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
