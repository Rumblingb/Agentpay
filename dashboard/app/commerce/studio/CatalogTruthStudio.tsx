'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Code2,
  DatabaseZap,
  Eye,
  ImageIcon,
  Link2,
  PackageCheck,
  Paintbrush,
  RefreshCw,
  Route,
  ShieldCheck,
  ShoppingBag,
  Store,
  Target,
  TriangleAlert,
  UploadCloud,
  WandSparkles,
  X,
} from 'lucide-react';
import { useState } from 'react';

import styles from './studio.module.css';

type View = 'demand' | 'truth' | 'visuals';
type DemandId = 'commute' | 'small-space' | 'unplug' | 'gift';

const DEMAND = [
  { id: 'commute' as const, label: 'Rain-ready commute', index: 88, gap: '2 catalog matches', color: 'cobalt' },
  { id: 'small-space' as const, label: 'Small-space reset', index: 82, gap: '1 catalog match', color: 'green' },
  { id: 'unplug' as const, label: 'A quieter evening', index: 71, gap: '3 catalog matches', color: 'coral' },
  { id: 'gift' as const, label: 'Useful gifts under £75', index: 67, gap: '2 catalog matches', color: 'yellow' },
];

const PRODUCTS = [
  { id: 'tidepack', name: 'Tidepack Commuter', merchant: 'Northline Goods', price: '£96', image: '/commerce/commute-products.webp', position: '0% 50%', fit: 97, truth: 98, fee: '£7.68', ready: 6 },
  { id: 'hush', name: 'Hush 45', merchant: 'Aster Audio', price: '£129', image: '/commerce/commute-products.webp', position: '50% 50%', fit: 91, truth: 96, fee: '£10.32', ready: 5 },
  { id: 'shell', name: 'Mossline Shell', merchant: 'Field & Form', price: '£89', image: '/commerce/commute-products.webp', position: '100% 50%', fit: 95, truth: 99, fee: '£7.12', ready: 6 },
  { id: 'lamp', name: 'Beam Mini', merchant: 'Common Object', price: '£46', image: '/commerce/home-products.webp', position: '0% 50%', fit: 96, truth: 94, fee: '£3.68', ready: 4 },
  { id: 'stack', name: 'Stack System', merchant: 'Room Made', price: '£62', image: '/commerce/home-products.webp', position: '50% 50%', fit: 98, truth: 97, fee: '£4.96', ready: 5 },
  { id: 'halo', name: 'Dawn Halo', merchant: 'Good Morning Co.', price: '£54', image: '/commerce/home-products.webp', position: '100% 50%', fit: 93, truth: 95, fee: '£4.32', ready: 4 },
];

const CHANNELS = ['Site', 'Schema', 'Google', 'OpenAI', 'UCP', 'Checkout'];

const NEED_MATCHES: Record<DemandId, string[]> = {
  commute: ['tidepack', 'shell', 'hush'],
  'small-space': ['stack', 'lamp', 'halo'],
  unplug: ['halo', 'hush', 'lamp'],
  gift: ['lamp', 'halo', 'stack'],
};

export default function CatalogTruthStudio() {
  const [view, setView] = useState<View>('demand');
  const [selectedDemand, setSelectedDemand] = useState<DemandId>('commute');
  const [selectedProductId, setSelectedProductId] = useState('tidepack');
  const [connectOpen, setConnectOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  const [visualsApproved, setVisualsApproved] = useState(false);
  const [auditFresh, setAuditFresh] = useState(false);
  const demand = DEMAND.find((item) => item.id === selectedDemand) ?? DEMAND[0];
  const matches = NEED_MATCHES[selectedDemand].map((id) => PRODUCTS.find((product) => product.id === id) ?? PRODUCTS[0]);
  const selected = PRODUCTS.find((product) => product.id === selectedProductId) ?? PRODUCTS[0];

  function chooseDemand(id: DemandId) {
    setSelectedDemand(id);
    setSelectedProductId(NEED_MATCHES[id][0]);
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/commerce"><ShieldCheck aria-hidden="true" /><span>AgentPay</span><small>Seller</small></Link>
        <nav aria-label="AgentPay commerce">
          <Link href="/commerce"><ShoppingBag aria-hidden="true" /> Discover</Link>
          <Link className={styles.navActive} href="/commerce/studio"><Store aria-hidden="true" /> Sell</Link>
        </nav>
        <div className={styles.headerActions}>
          <span>Sandbox data</span>
          <button type="button" onClick={() => setApiOpen(true)} aria-label="Open API preview"><Code2 aria-hidden="true" /></button>
        </div>
      </header>

      <main>
        <section className={styles.titleBand}>
          <div><p>AgentPay Seller</p><h1>Turn demand into sales.</h1></div>
          <div className={styles.titleActions}>
            <Link href="/commerce"><Eye aria-hidden="true" /> Storefront</Link>
            <button type="button" onClick={() => setConnectOpen(true)}><Link2 aria-hidden="true" /> Connect store</button>
          </div>
        </section>

        <section className={styles.metrics} aria-label="Seller sandbox summary">
          <div><BarChart3 aria-hidden="true" /><span>Demand index</span><strong>88</strong></div>
          <div><Target aria-hidden="true" /><span>Catalog matches</span><strong>6</strong></div>
          <div><BadgeCheck aria-hidden="true" /><span>Channel ready</span><strong>4/6</strong></div>
          <div><CircleDollarSign aria-hidden="true" /><span>Success fee</span><strong>8%</strong><small>after returns</small></div>
        </section>

        <nav className={styles.viewTabs} aria-label="Seller tools">
          <button className={view === 'demand' ? styles.tabActive : undefined} type="button" onClick={() => setView('demand')}><Target aria-hidden="true" /> Demand</button>
          <button className={view === 'truth' ? styles.tabActive : undefined} type="button" onClick={() => setView('truth')}><DatabaseZap aria-hidden="true" /> Catalog truth</button>
          <button className={view === 'visuals' ? styles.tabActive : undefined} type="button" onClick={() => setView('visuals')}><ImageIcon aria-hidden="true" /> Visual studio</button>
        </nav>

        {view === 'demand' ? (
          <section className={styles.demandLayout}>
            <div className={styles.demandPanel}>
              <div className={styles.sectionHeader}><div><p>Demand radar</p><h2>Needs gaining intent</h2></div><span>Demo index · 0–100</span></div>
              <div className={styles.demandGrid}>
                {DEMAND.map((item) => (
                  <button className={item.id === selectedDemand ? styles.demandActive : styles.demandCard} key={item.id} type="button" onClick={() => chooseDemand(item.id)}>
                    <span className={styles[item.color]}><Route aria-hidden="true" /></span>
                    <strong>{item.index}</strong>
                    <h3>{item.label}</h3>
                    <div><i style={{ width: `${item.index}%` }} /></div>
                    <small>{item.gap}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.matchPanel}>
              <div className={styles.sectionHeader}><div><p>Matched inventory</p><h2>{demand.label}</h2></div><span>Fit · truth · fee</span></div>
              <div className={styles.matchRows}>
                {matches.map((product) => (
                  <button className={product.id === selected.id ? styles.matchActive : styles.matchRow} key={product.id} type="button" onClick={() => setSelectedProductId(product.id)}>
                    <span className={styles.thumb}><Image src={product.image} alt="" fill sizes="58px" style={{ objectFit: 'cover', objectPosition: product.position }} /></span>
                    <span><strong>{product.name}</strong><small>{product.price} · {product.merchant}</small></span>
                    <span className={styles.fitScore}>{product.fit}<small>fit</small></span>
                    <span className={styles.truthScore}>{product.truth}<small>truth</small></span>
                    <span className={styles.feeScore}>{product.fee}<small>fee</small></span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>

            <aside className={styles.opportunity}>
              <span className={styles.largeProduct}><Image src={selected.image} alt={selected.name} fill priority sizes="360px" style={{ objectFit: 'cover', objectPosition: selected.position }} /></span>
              <div className={styles.opportunityTitle}><div><p>Lead match</p><h2>{selected.name}</h2><span>{selected.merchant}</span></div><strong>{selected.fit}%</strong></div>
              <div className={styles.opportunityFacts}>
                <span><Target aria-hidden="true" /><small>Need fit</small><strong>{demand.label}</strong></span>
                <span><DatabaseZap aria-hidden="true" /><small>Catalog truth</small><strong>{selected.truth}/100</strong></span>
                <span><CircleDollarSign aria-hidden="true" /><small>AgentPay fee</small><strong>{selected.fee}</strong></span>
              </div>
              <button type="button" onClick={() => setView('truth')}>Check every channel <ArrowRight aria-hidden="true" /></button>
              <small>Fee draft only. Activation requires a merchant agreement and approved payment configuration.</small>
            </aside>
          </section>
        ) : null}

        {view === 'truth' ? (
          <section className={styles.truthLayout}>
            <div className={styles.sectionHeader}>
              <div><p>Catalog truth</p><h2>One product, six surfaces</h2></div>
              <button className={styles.auditButton} type="button" onClick={() => setAuditFresh(true)}><RefreshCw aria-hidden="true" /> {auditFresh ? 'Audited now' : 'Run sandbox audit'}</button>
            </div>
            <div className={styles.channelHeader}><span>Product</span>{CHANNELS.map((channel) => <span key={channel}>{channel}</span>)}<span>Truth</span></div>
            <div className={styles.productRows}>
              {PRODUCTS.slice(0, 4).map((product) => (
                <button className={product.id === selected.id ? styles.productRowActive : styles.productRow} key={product.id} type="button" onClick={() => setSelectedProductId(product.id)}>
                  <span className={styles.productIdentity}><span className={styles.thumb}><Image src={product.image} alt="" fill sizes="48px" style={{ objectFit: 'cover', objectPosition: product.position }} /></span><span><strong>{product.name}</strong><small>{product.merchant}</small></span></span>
                  {CHANNELS.map((channel, index) => {
                    const warning = index >= product.ready;
                    return <span className={warning ? styles.channelWarn : styles.channelGood} key={channel} aria-label={`${channel}: ${warning ? 'needs attention' : 'ready'}`}>{warning ? <TriangleAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}</span>;
                  })}
                  <span className={styles.rowScore}>{product.truth}</span>
                </button>
              ))}
            </div>
            <div className={styles.truthInspector}>
              <div><DatabaseZap aria-hidden="true" /><span>Search</span><strong>{selected.ready >= 3 ? 'Ready' : 'Fix'}</strong></div>
              <div><WandSparkles aria-hidden="true" /><span>Agents</span><strong>{selected.ready >= 5 ? 'Ready' : 'Fix feed'}</strong></div>
              <div><ShoppingBag aria-hidden="true" /><span>Checkout</span><strong>{selected.ready === 6 ? 'Ready' : 'Verify'}</strong></div>
              <button type="button" onClick={() => setApiOpen(true)}>View exact issue <ChevronRight aria-hidden="true" /></button>
            </div>
          </section>
        ) : null}

        {view === 'visuals' ? (
          <section className={styles.visualLayout}>
            <div className={styles.sectionHeader}><div><p>Visual catalog</p><h2>Lifestyle in. Channel-ready out.</h2></div><span>Merchant approval required</span></div>
            <div className={styles.sourceVisual}>
              <Image src="/commerce/commute-hero.webp" alt="Source lifestyle image of a commuter wearing products" fill sizes="50vw" style={{ objectFit: 'cover' }} />
              <span><UploadCloud aria-hidden="true" /> Source evidence</span>
            </div>
            <div className={styles.outputVisuals}>
              <div className={styles.visualSteps}>
                <span className={styles.stepDone}><Check aria-hidden="true" /><small>1</small>Detect</span>
                <i />
                <span className={styles.stepDone}><Check aria-hidden="true" /><small>2</small>Reconstruct</span>
                <i />
                <span className={visualsApproved ? styles.stepDone : styles.stepActive}>{visualsApproved ? <Check aria-hidden="true" /> : <Eye aria-hidden="true" />}<small>3</small>Review</span>
              </div>
              <div className={styles.cutoutGrid}>
                {PRODUCTS.slice(0, 3).map((product) => (
                  <span key={product.id}><Image src={product.image} alt={product.name} fill sizes="180px" style={{ objectFit: 'cover', objectPosition: product.position }} /><i>{visualsApproved ? <CheckCircle2 aria-hidden="true" /> : <Eye aria-hidden="true" />}{visualsApproved ? 'Approved' : 'Review'}</i></span>
                ))}
              </div>
              <div className={styles.visualActions}>
                <div><BadgeCheck aria-hidden="true" /><span>Source bound</span></div>
                <div><Paintbrush aria-hidden="true" /><span>No invented marks</span></div>
                <button type="button" onClick={() => setVisualsApproved((current) => !current)}>{visualsApproved ? 'Reopen review' : 'Approve 3 images'} <ArrowRight aria-hidden="true" /></button>
              </div>
            </div>
          </section>
        ) : null}
      </main>

      {connectOpen ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={() => setConnectOpen(false)}>
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="connect-heading" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.drawerHeader}><div><p>Seller connection</p><h2 id="connect-heading">Bring your catalog.</h2></div><button type="button" onClick={() => setConnectOpen(false)} aria-label="Close store connection"><X aria-hidden="true" /></button></div>
            <div className={styles.connectors}>
              <button type="button"><Store aria-hidden="true" /><span><strong>Shopify</strong><small>Catalog + merchant checkout</small></span><ChevronRight aria-hidden="true" /></button>
              <button type="button"><PackageCheck aria-hidden="true" /><span><strong>WooCommerce</strong><small>Products + order events</small></span><ChevronRight aria-hidden="true" /></button>
              <button type="button"><DatabaseZap aria-hidden="true" /><span><strong>Product feed</strong><small>CSV, JSON, or Merchant feed</small></span><ChevronRight aria-hidden="true" /></button>
            </div>
            <p className={styles.drawerGate}><ShieldCheck aria-hidden="true" /> This local preview does not connect an account. OAuth and production catalog access require action-time approval.</p>
          </aside>
        </div>
      ) : null}

      {apiOpen ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={() => setApiOpen(false)}>
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="api-heading" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.drawerHeader}><div><p>AgentPay API + MCP</p><h2 id="api-heading">Catalog growth tools</h2></div><button type="button" onClick={() => setApiOpen(false)} aria-label="Close API preview"><X aria-hidden="true" /></button></div>
            <code>agentpay_discover_products</code>
            <code>agentpay_audit_catalog_truth</code>
            <div className={styles.apiList}>
              <span><Target aria-hidden="true" /> Need-led ranking with hard filters</span>
              <span><DatabaseZap aria-hidden="true" /> Search and agent feed drift</span>
              <span><CircleDollarSign aria-hidden="true" /> Signed attribution draft</span>
              <span><ShieldCheck aria-hidden="true" /> Sponsorship never changes fit rank</span>
            </div>
            <Link href="/docs">Developer docs <ChevronRight aria-hidden="true" /></Link>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
