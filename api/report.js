// api/report.js — TCC CRM Daily Email Report
// Runs automatically via Vercel cron (add to vercel.json) or hit manually:
// GET https://tcc-crm.vercel.app/api/report?preview=1

const SB_URL = "https://zotmzaezodgszcjbfktt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvdG16YWV6b2Rnc3pjamJma3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODQ1MzAsImV4cCI6MjA5MDU2MDUzMH0.wGxNInF52zyhwHsDvuWJDRpVrxgDBgCCOVlq0rTHhyE";

const ACCOUNTS = [
  { id:"alejandro", label:"Alejandro",      color:"#c9943a" },
  { id:"alexandra", label:"Alexandra",       color:"#8b5cf6" },
  { id:"tcc",       label:"The Coffee Code", color:"#10b981" },
];

const STAGES = [
  { id:"discovery",  label:"Discovery",   steps:6 },
  { id:"warmup",     label:"Warm-Up",     steps:6 },
  { id:"outreach",   label:"DM Outreach", steps:7 },
  { id:"sample",     label:"Sample Kit",  steps:6 },
  { id:"activation", label:"Activation",  steps:7 },
  { id:"conversion", label:"Conversion",  steps:6 },
];
const TOTAL_STEPS = STAGES.reduce((a,s)=>a+s.steps,0);

const STAGE_STEP_IDS = {
  discovery:  ["s1_1","s1_2","s1_3","s1_4","s1_5","s1_6"],
  warmup:     ["s2_1","s2_2","s2_3","s2_4","s2_5","s2_6"],
  outreach:   ["s3_1","s3_2","s3_3","s3_4","s3_5","s3_6","s3_7"],
  sample:     ["s4_1","s4_2","s4_3","s4_4","s4_5","s4_6"],
  activation: ["s5_1","s5_2","s5_3","s5_4","s5_5","s5_6","s5_7"],
  conversion: ["s6_1","s6_2","s6_3","s6_4","s6_5","s6_6"],
};

function overallPct(inf) {
  const done = Object.values(inf.steps||{}).filter(Boolean).length;
  return Math.round(done / TOTAL_STEPS * 100);
}

function stagePct(inf, stageId) {
  const ids = STAGE_STEP_IDS[stageId] || [];
  if (!ids.length) return 0;
  const done = ids.filter(id => (inf.steps||{})[id]).length;
  return Math.round(done / ids.length * 100);
}

function currentStage(inf) {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (stagePct(inf, STAGES[i].id) > 0) return STAGES[i];
  }
  return STAGES[0];
}

function needsAction(inf) {
  const steps = inf.steps || {};
  if (!steps.s1_6) return "Complete Discovery checklist";
  if (!steps.s2_1) return "Start Warm-Up — follow their account";
  if (!steps.s3_1) return "Send Day 1 DM";
  if (steps.s3_1 && !steps.s3_2 && !steps.s3_4) return "Send Day 3 follow-up";
  if (steps.s3_4 && !steps.s3_2 && !steps.s3_5) return "Send Day 7 final follow-up";
  if (steps.s3_2 && !steps.s4_1) return "Collect shipping address";
  if (steps.s4_1 && !steps.s4_3) return "Ship sample kit";
  if (steps.s4_3 && !steps.s5_1) return "Send affiliate link";
  if (steps.s5_1 && !steps.s5_4) return "Confirm post is live";
  if (steps.s5_4 && !steps.s6_1) return "Verify first sale tracked";
  return null;
}

async function fetchInfluencers() {
  const res = await fetch(`${SB_URL}/rest/v1/influencers?select=*&order=id.desc`, {
    headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  const rows = await res.json();
  return rows.map(r => ({ ...r.data, handle: r.handle }));
}

function buildHTML(infs) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
  const C = { bg:"#ffffff", panel:"#f8f6f3", card:"#f2ede8", border:"#e0d8cf", gold:"#a0722a", text:"#1a1208", muted:"#6b5a3e", dim:"#9c8a6e", green:"#0d7a5f", orange:"#c4621a", red:"#c0392b", purple:"#6d4faa" };

  // Global stats
  const total      = infs.length;
  const converting = infs.filter(i => i.status === "converting").length;
  const active     = infs.filter(i => i.status === "active").length;
  const declined   = infs.filter(i => i.status === "declined").length;

  // Per-account sections
  const acctSections = ACCOUNTS.map(acct => {
    const list = infs.filter(i => (i.account || "alejandro") === acct.id);
    if (!list.length) return `
      <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;padding:14px 16px;margin-bottom:16px;">
        <div style="font-size:9px;color:${acct.color};letter-spacing:2px;font-family:monospace;text-transform:uppercase;margin-bottom:4px;">${acct.label}</div>
        <div style="font-size:12px;color:${C.dim};">No influencers assigned to this account yet.</div>
      </div>`;

    const acctConverting = list.filter(i => i.status === "converting").length;
    const acctActive     = list.filter(i => i.status === "active").length;
    const acctDue        = list.filter(i => needsAction(i) && i.status === "active");

    const rows = list.map(inf => {
      const pct   = overallPct(inf);
      const stg   = currentStage(inf);
      const action = needsAction(inf);
      const stat  = inf.status || "active";
      const statColor = stat==="converting"?C.green:stat==="declined"?C.red:stat==="paused"?C.dim:C.orange;
      return `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-family:monospace;color:${acct.color};font-size:12px;">@${inf.handle||"?"}</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};">${inf.niche||"—"}</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};">${stg.label}</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;font-family:monospace;color:${pct===100?C.green:pct>50?"#f59e0b":C.muted};">${pct}%</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${statColor};font-family:monospace;">${stat}</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${action?C.orange:C.green};">${action||"On track"}</td>
      </tr>`;
    }).join("");

    return `
    <div style="margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-size:14px;font-weight:bold;color:${acct.color};">${acct.label}</div>
        <div style="display:flex;gap:12px;font-size:10px;font-family:monospace;">
          <span style="color:${C.text};">${list.length} total</span>
          <span style="color:${C.green};">${acctConverting} converting</span>
          <span style="color:${C.orange};">${acctActive} active</span>
          ${acctDue.length>0?`<span style="color:${C.red};font-weight:bold;">⚡ ${acctDue.length} need action</span>`:""}
        </div>
      </div>
      <div style="border:1px solid ${C.border};border-radius:4px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#0f0d07;">
              <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;text-align:left;font-weight:normal;">HANDLE</th>
              <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;text-align:left;font-weight:normal;">NICHE</th>
              <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;text-align:left;font-weight:normal;">STAGE</th>
              <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;text-align:left;font-weight:normal;">PROGRESS</th>
              <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;text-align:left;font-weight:normal;">STATUS</th>
              <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;text-align:left;font-weight:normal;">NEXT ACTION</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>TCC CRM Report — ${dateStr}</title></head>
<body style="margin:0;padding:0;background:${C.bg};color:${C.text};font-family:Georgia,serif;font-size:13px;">
<div style="max-width:760px;margin:0 auto;padding:24px 16px;">

  <div style="border-bottom:1px solid ${C.border};padding-bottom:16px;margin-bottom:24px;">
    <div style="font-size:9px;letter-spacing:3px;color:${C.muted};font-family:monospace;text-transform:uppercase;margin-bottom:4px;">THE COFFEE CODE</div>
    <div style="font-size:24px;font-weight:bold;color:${C.gold};">Daily CRM Report</div>
    <div style="font-size:12px;color:${C.muted};margin-top:4px;">${dateStr}</div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px;">
    ${[["Total",total,C.text],["Converting",converting,C.green],["Active",active,C.orange],["Declined",declined,C.dim]].map(([l,v,c])=>`
    <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;padding:12px;text-align:center;">
      <div style="font-size:24px;font-weight:bold;color:${c};font-family:monospace;line-height:1;">${v}</div>
      <div style="font-size:9px;color:${C.dim};letter-spacing:1.5px;margin-top:4px;font-family:monospace;">${l}</div>
    </div>`).join("")}
  </div>

  ${acctSections}

  <div style="border-top:1px solid ${C.border};padding-top:14px;font-size:10px;color:${C.dim};font-family:monospace;line-height:2;">
    <div>Generated: ${now.toISOString()}</div>
    <div style="margin-top:6px;"><a href="https://tcc-crm.vercel.app" style="color:${C.gold};">Open CRM</a></div>
  </div>

</div>
</body>
</html>`;
}

async function sendEmail(html, subject) {
  const key   = process.env.RESEND_API_KEY;
  const email = process.env.REPORT_EMAIL;
  if (!key || !email) return { skipped: true };
  const res = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${key}` },
    body: JSON.stringify({ from:"TCC CRM <onboarding@resend.dev>", to:[email], subject, html })
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`);
  return data;
}

export default async function handler(req, res) {
  try {
    const infs = await fetchInfluencers();
    const html = buildHTML(infs);
    const preview = req.query?.preview === "1";

    if (preview) {
      res.setHeader("Content-Type","text/html");
      return res.status(200).send(html);
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
    const converting = infs.filter(i=>i.status==="converting").length;
    const due = infs.filter(i=>needsAction(i)&&i.status==="active").length;
    const subject = `TCC CRM ${dateStr} — ${infs.length} contacts · ${converting} converting · ${due} need action`;

    const result = await sendEmail(html, subject);
    res.status(200).json({ ok:true, sent:!result.skipped, total:infs.length, converting, due });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok:false, error:e.message });
  }
}
