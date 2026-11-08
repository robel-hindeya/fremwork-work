"use client";

import Link from "next/link";
import { Building2, CreditCard, Landmark, Users } from "lucide-react";
import { Banner, PageHeader, Status } from "@/components/ui";
import { INTEGRATIONS } from "@/lib/data";

const ICONS: Record<string, typeof Building2> = { qb: Building2, xero: Building2, bank: Landmark, stripe: CreditCard, gusto: Users };

export default function DataSources() {
  return (
    <div className="page">
      <PageHeader eyebrow="Financial tools" title="Data sources" sub="Where Fremwork reads your numbers from." />
      <Banner tone="info" title="Automatic connections aren’t available yet.">For now, <Link href="/transactions">add transactions yourself</Link> and <Link href="/chat">ask the AI to analyze them</Link>.</Banner>
      <section className="card">
        <div className="card-head"><div><h2>Connections</h2><p>Planned integrations</p></div></div>
        {INTEGRATIONS.map((s) => {
          const I = ICONS[s.id] ?? Building2;
          return (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", padding: "16px 20px", borderTop: "1px solid var(--line)" }}>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--rail)", display: "grid", placeItems: "center" }}><I size={20} /></div>
                <div><b style={{ fontWeight: 500 }}>{s.name}</b><small className="muted" style={{ display: "block", fontSize: 12 }}>{s.kind}</small></div>
              </div>
              <Status tone="">Coming soon</Status>
            </div>
          );
        })}
      </section>
    </div>
  );
}
