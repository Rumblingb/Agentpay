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
  Sparkles,
  Store,
  Tag,
  Truck,
  Undo2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import styles from './commerce.module.css';
import { NEEDS, PRODUCTS, type Need, type Product } from './commerceCatalog';

type Stage = 'review' | 'checkout' | 'receipt';

type Compilation = {
  source: 'gpt-5.6-verified' | 'deterministic';
  model: string | null;
  selectedProductId: string | null;
  ranking: Array<{ productId: string; rationaleCodes: string[] }>;
};

type CompilerState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: Compilation }
  | { status: 'error' };

const RATIONALE_LABELS: Record<string, string> = {
  strongest_need_fit: 'Need fit',
  catalog_truth_leader: 'Catalog truth',
  quality_leader: 'Quality',
  budget_fit: 'Budget fit',
  returns_strength: 'Returns',
  balanced_choice: 'Balanced choice',
};
const RATIONALE_CODES = new Set(Object.keys(RATIONALE_LABELS));

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
  const [compiler, setCompiler] = useState<CompilerState>({ status: 'idle' });

  const needConfig = NEEDS.find((item) => item.id === need) ?? NEEDS[0];
  const baseRanked = useMemo(() => PRODUCTS
    .filter((product) => product.priceMinor <= budgetMinor)
    .filter((product) => product.deliveryDays <= maxDeliveryDays)
    .filter((product) => !easyReturns || product.returnDays >= 30)
    .filter((product) => product.needScores[need] >= 50)
    .sort((a, b) => b.needScores[need] - a.needScores[need]), [budgetMinor, easyReturns, maxDeliveryDays, need]);
  const ranked = useMemo(() => {
    if (compiler.status !== 'success') return baseRanked;
    const positions = new Map(compiler.data.ranking.map((item, index) => [item.productId, index]));
    return baseRanked.slice().sort((a, b) => (positions.get(a.id) ?? 999) - (positions.get(b.id) ?? 999));
  }, [baseRanked, compiler]);
  const selected = ranked.find((product) => product.id === selectedId) ?? ranked[0] ?? PRODUCTS[0];
  const selectedRationale = compiler.status === 'success'
    ? compiler.data.ranking.find((item) => item.productId === selected.id)?.rationaleCodes ?? []
    : [];

  function resetApproval() {
    setApproved(false);
    setStage('review');
  }

  function invalidateCompiler() {
    setCompiler({ status: 'idle' });
    resetApproval();
  }

  async function compileShortlist() {
    setCompiler({ status: 'loading' });
    resetApproval();
    try {
      const response = await fetch('/api/commerce/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ need, budgetMinor, maxDeliveryDays, easyReturns }),
      });
      if (!response.ok) throw new Error('compiler unavailable');
      const payload = await response.json() as { packet?: { compilation?: Compilation } };
      const compilation = payload.packet?.compilation;
      if (!compilation
        || !['gpt-5.6-verified', 'deterministic'].includes(compilation.source)
        || !Array.isArray(compilation.ranking)
        || compilation.ranking.some((item) => !item
          || typeof item.productId !== 'string'
          || !Array.isArray(item.rationaleCodes)
          || item.rationaleCodes.length < 1
          || item.rationaleCodes.some((code) => !RATIONALE_CODES.has(code)))) {
        throw new Error('invalid compiler response');
      }
      const eligibleIds = new Set(baseRanked.map((product) => product.id));
      const compiledIds = compilation.ranking.map((item) => item.productId);
      if (compiledIds.length !== eligibleIds.size
        || new Set(compiledIds).size !== eligibleIds.size
        || compiledIds.some((productId) => !eligibleIds.has(productId))
        || compilation.selectedProductId !== compiledIds[0]) {
        throw new Error('compiler changed candidate set');
      }
      setCompiler({ status: 'success', data: compilation });
      if (compilation.selectedProductId && eligibleIds.has(compilation.selectedProductId)) setSelectedId(compilation.selectedProductId);
    } catch {
      setCompiler({ status: 'error' });
    }
  }

  function chooseNeed(nextNeed: Need) {
    const nextConfig = NEEDS.find((item) => item.id === nextNeed) ?? NEEDS[0];
    const nextProduct = [...PRODUCTS].sort((a, b) => b.needScores[nextNeed] - a.needScores[nextNeed])[0];
    setNeed(nextNeed);
    setBudgetMinor(nextConfig.budgetMinor);
    setSelectedId(nextProduct.id);
    invalidateCompiler();
  }

  function resetBrief() {
    setBudgetMinor(needConfig.budgetMinor);
    setMaxDeliveryDays(3);
    setEasyReturns(true);
    invalidateCompiler();
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
                onChange={(event) => { setBudgetMinor(Number(event.target.value)); invalidateCompiler(); }}
              />
            </label>
            <div className={styles.segmentControl}>
              <span><Truck aria-hidden="true" /> Arrives</span>
              <div>
                {[2, 3, 5].map((days) => (
                  <button className={maxDeliveryDays === days ? styles.segmentActive : undefined} key={days} type="button" onClick={() => { setMaxDeliveryDays(days); invalidateCompiler(); }}>{days}d</button>
                ))}
              </div>
            </div>
            <label className={styles.toggleControl}>
              <span><PackageCheck aria-hidden="true" /> 30+ day returns</span>
              <input type="checkbox" checked={easyReturns} onChange={(event) => { setEasyReturns(event.target.checked); invalidateCompiler(); }} />
              <i aria-hidden="true"><b /></i>
            </label>
          </div>
        </section>

        <section className={styles.results} aria-labelledby="results-heading">
          <div className={styles.resultsHeader}>
            <div><p>{ranked.length} eligible matches</p><h2 id="results-heading">Best fit first</h2></div>
            <div className={styles.resultsTools}>
              <div className={styles.rankingKey}><BadgeCheck aria-hidden="true" /><span>Sponsored never changes fit score</span></div>
              <button className={styles.compileAction} type="button" disabled={!baseRanked.length || compiler.status === 'loading'} onClick={compileShortlist}>
                <Sparkles aria-hidden="true" />
                <span>{compiler.status === 'loading' ? 'Compiling…' : 'Compile shortlist'}</span>
              </button>
            </div>
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
                  {compiler.status === 'success' ? (
                    <div className={compiler.data.source === 'gpt-5.6-verified' ? styles.compilerVerified : styles.compilerFallback}>
                      <Sparkles aria-hidden="true" />
                      <div>
                        <strong>{compiler.data.source === 'gpt-5.6-verified' ? 'GPT-5.6 output verified' : 'Policy-safe fallback'}</strong>
                        <span>{selectedRationale.map((code) => RATIONALE_LABELS[code] ?? code).join(' · ')}</span>
                      </div>
                      <BadgeCheck aria-label="Candidate set preserved" />
                    </div>
                  ) : null}
                  {compiler.status === 'error' ? <p className={styles.compilerError}>Compiler unavailable. Deterministic rank remains active.</p> : null}
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
            <code>POST /api/commerce/compile</code>
            <pre>{`{
  "need": "rain-ready-commute",
  "budgetMinor": 15000,
  "currency": "GBP",
  "maxDeliveryDays": 3,
  "minReturnDays": 30
}`}</pre>
            <div className={styles.apiFacts}>
              <span><ShieldCheck aria-hidden="true" /> Hard constraints stay deterministic</span>
              <span><Sparkles aria-hidden="true" /> GPT-5.6 sees opaque refs + scores only</span>
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
