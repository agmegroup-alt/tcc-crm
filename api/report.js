// api/report.js
// Vercel Serverless Function — Daily TCC Influencer Report
// Triggered automatically every day at 11am UTC via vercel.json cron
// Also callable manually: GET /api/report?preview=1  (returns HTML in browser)
// Sends email via Resend — add RESEND_API_KEY + REPORT_EMAIL to Vercel env vars

const SUPABASE_URL      = “https://zotmzaezodgszcjbfktt.supabase.co”;
const SUPABASE_ANON_KEY = “eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvdG16YWV6b2Rnc3pjamJma3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODQ1MzAsImV4cCI6MjA5MDU2MDUzMH0.wGxNInF52zyhwHsDvuWJDRpVrxgDBgCCOVlq0rTHhyE”;

// ── Add these in Vercel dashboard → Settings → Environment Variables ──────
// RESEND_API_KEY   →  your Resend API key  (get free at resend.com)
// REPORT_EMAIL     →  email to receive the report  e.g. agmegroup@gmail.com
// ─────────────────────────────────────────────────────────────────────────

const STAGES = [“new”,“researched”,“dm_sent”,“replied”,“call_booked”,“sample_sent”,“converting”,“declined”,“paused”];
const STAGE_LABELS = { new:“New”, researched:“Researched”, dm_sent:“DM Sent”, replied:“Replied”, call_booked:“Call Booked”, sample_sent:“Sample Sent”, converting:“Converting”, declined:“Declined”, paused:“Paused” };

function today() { return new Date().toISOString().split(“T”)[0]; }
function daysAgo(d) { return d ? Math.floor((Date.now() - new Date(d)) / 86400000) : 0; }

function nextAction(inf) {
const a = inf.actions || {};
if (!a.first_contact)    return { label:“Send first DM”,         urgency:“high”   };
if (!a.follow_up_1) {
const d = daysAgo(inf.dmDate);
if (d >= 3)            return { label:“Send Day-3 follow-up”,  urgency:“high”   };
return                        { label:`Follow-up in ${3-d}d`,  urgency:“low”    };
}
if (!a.follow_up_2) {
if (daysAgo(inf.dmDate) >= 14) return { label:“Send Week-2 follow-up”, urgency:“high” };
return                                { label:“Awaiting reply”,         urgency:“low”  };
}
if (!a.reply_received)   return { label:“Awaiting reply”,        urgency:“low”    };
if (!a.sample_offered)   return { label:“Offer sample kit”,      urgency:“high”   };
if (!a.address_received) return { label:“Get shipping address”,  urgency:“medium” };
if (!a.sample_shipped)   return { label:“Ship the sample”,       urgency:“high”   };
if (!a.feedback_received)return { label:“Request feedback”,      urgency:“medium” };
if (!a.affiliate_agreed) return { label:“Close affiliate deal”,  urgency:“high”   };
if (!a.link_sent)        return { label:“Send affiliate link”,   urgency:“high”   };
if (!a.first_post)       return { label:“Awaiting first post”,   urgency:“low”    };
if (!a.commission_paid)  return { label:“Pay commission”,        urgency:“medium” };
return                          { label:“Active ✓”,              urgency:“done”   };
}

function pct(n, total) {
return total === 0 ? “0%” : Math.round((n / total) * 100) + “%”;
}

async function fetchInfluencers() {
const res = await fetch(
`${SUPABASE_URL}/rest/v1/influencers?select=*&order=id.desc`,
{
headers: {
“apikey”: SUPABASE_ANON_KEY,
“Authorization”: `Bearer ${SUPABASE_ANON_KEY}`,
“Content-Type”: “application/json”
}
}
);
if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
const rows = await res.json();
return rows.map(row => ({ …row.data, handle: row.handle }));
}

function buildReport(infs) {
const now        = new Date();
const dateStr    = now.toLocaleDateString(“en-US”, { weekday:“long”, year:“numeric”, month:“long”, day:“numeric” });
const total      = infs.length;

// Pipeline counts
const byStage    = {};
STAGES.forEach(s => byStage[s] = infs.filter(i => i.stage === s).length);

// Action urgency
const dueToday   = infs.filter(i => nextAction(i).urgency === “high”);
const dueMedium  = infs.filter(i => nextAction(i).urgency === “medium”);
const converting = infs.filter(i => i.stage === “converting”);
const sampleOut  = infs.filter(i => i.stage === “sample_sent”);
const replied    = infs.filter(i => i.stage === “replied”);
const dmSent     = infs.filter(i => i.stage === “dm_sent” || [“replied”,“call_booked”,“sample_sent”,“converting”].includes(i.stage));
const declined   = infs.filter(i => i.stage === “declined”);

// Conversion funnel
const contacted  = infs.filter(i => (i.actions||{}).first_contact).length;
const gotReply   = infs.filter(i => (i.actions||{}).reply_received).length;
const sampleSent = infs.filter(i => (i.actions||{}).sample_shipped).length;
const converted  = infs.filter(i => (i.actions||{}).first_post).length;
const replyRate  = contacted > 0 ? Math.round((gotReply  / contacted)  * 100) : 0;
const sampleRate = gotReply  > 0 ? Math.round((sampleSent/ gotReply)   * 100) : 0;
const convRate   = sampleSent> 0 ? Math.round((converted / sampleSent) * 100) : 0;

// Priority A contacts not yet contacted
const uncontacted = infs.filter(i => !(i.actions||{}).first_contact && (i.tccFitScore||0) >= 7);

// Average fit score
const avgScore = total > 0
? (infs.reduce((s, i) => s + (i.tccFitScore || 0), 0) / total).toFixed(1)
: “—”;

// Recent additions (last 7 days)
const recent = infs.filter(i => daysAgo(i.addedDate) <= 7);

// Stalled: DM sent but no reply in 14+ days
const stalled = infs.filter(i => {
const a = i.actions || {};
return a.first_contact && !a.reply_received && daysAgo(i.dmDate) >= 14;
});

// Week targets (based on TCC 18-week plan)
const weekTarget10 = converting.length >= 10;

// ── HTML REPORT ──────────────────────────────────────────────────────
const C = {
bg:”#0a0906”, panel:”#111009”, card:”#161410”, border:”#2a2418”,
gold:”#c9943a”, text:”#e4dccb”, muted:”#7a6840”, dim:”#4a3c24”,
red:”#ef4444”, green:”#10b981”, orange:”#f97316”, yellow:”#f59e0b”, purple:”#8b5cf6”
};

const stageBar = STAGES.filter(s => byStage[s] > 0).map(s => {
const colors = { new:”#5a5248”, researched:”#6366f1”, dm_sent:”#3b82f6”, replied:”#8b5cf6”, call_booked:”#f59e0b”, sample_sent:”#f97316”, converting:”#10b981”, declined:”#ef4444”, paused:”#374151” };
const w = pct(byStage[s], total);
return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;"> <div style="width:100px;font-size:11px;color:${C.muted};font-family:monospace;">${STAGE_LABELS[s]}</div> <div style="flex:1;background:#1e1c14;border-radius:2px;height:6px;overflow:hidden;"> <div style="height:100%;background:${colors[s]};width:${w};border-radius:2px;"></div> </div> <div style="width:32px;text-align:right;font-size:11px;color:${C.text};font-family:monospace;">${byStage[s]}</div> <div style="width:36px;text-align:right;font-size:10px;color:${C.dim};font-family:monospace;">${w}</div> </div>`;
}).join(””);

const dueTodayRows = dueToday.slice(0, 20).map(inf => {
const na = nextAction(inf);
const score = inf.tccFitScore || 0;
const scoreColor = score >= 8 ? C.green : score >= 6 ? C.gold : C.yellow;
return `<tr> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-family:monospace;color:${C.gold};font-size:12px;">${inf.handle}</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};">${inf.inferredNiche||"—"}</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.orange};font-weight:bold;">${na.label}</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${scoreColor};font-family:monospace;text-align:center;">${score}/10</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};">${inf.dmDate ? `DM: ${inf.dmDate}` : "Not contacted"}</td> </tr>`;
}).join(””);

const convertingRows = converting.map(inf =>
`<tr> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-family:monospace;color:${C.green};font-size:12px;">${inf.handle}</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};">${inf.inferredNiche||"—"}</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};">${inf.inferredLocation||"—"}</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};">${inf.firstPostDate||"Pending"}</td> </tr>`
).join(””);

const stalledRows = stalled.slice(0, 10).map(inf =>
`<tr> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-family:monospace;color:${C.text};font-size:12px;">${inf.handle}</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};">${inf.inferredNiche||"—"}</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.red};font-family:monospace;">${daysAgo(inf.dmDate)}d ago</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};">Consider final follow-up or mark declined</td> </tr>`
).join(””);

const sampleRows = sampleOut.map(inf =>
`<tr> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-family:monospace;color:${C.text};font-size:12px;">${inf.handle}</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};">${inf.inferredNiche||"—"}</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.orange};font-family:monospace;">${inf.sampleDate ? `${daysAgo(inf.sampleDate)}d ago` : "—"}</td> <td style="padding:7px 10px;border-bottom:1px solid ${C.border};font-size:11px;color:${C.muted};">${inf.sampleDate && daysAgo(inf.sampleDate) >= 7 ? "⚡ Request feedback now" : "Waiting for delivery"}</td> </tr>`
).join(””);

const html = `<!DOCTYPE html>

<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>TCC Daily Report — ${dateStr}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};color:${C.text};font-family:Georgia,serif;font-size:13px;">
<div style="max-width:720px;margin:0 auto;padding:24px 16px;">

  <!-- HEADER -->

  <div style="border-bottom:1px solid ${C.border};padding-bottom:16px;margin-bottom:24px;">
    <div style="font-size:9px;letter-spacing:3px;color:${C.muted};font-family:monospace;text-transform:uppercase;margin-bottom:4px;">THE COFFEE CODE</div>
    <div style="font-size:24px;font-weight:bold;color:${C.gold};">Daily Influencer Report</div>
    <div style="font-size:12px;color:${C.muted};margin-top:4px;">${dateStr}</div>
  </div>

  <!-- ALERT BANNER: Due today -->

${dueToday.length > 0 ? `

  <div style="background:#1a0a00;border:1px solid #5a2200;border-radius:4px;padding:14px 16px;margin-bottom:20px;">
    <div style="font-size:9px;color:${C.orange};letter-spacing:2px;font-family:monospace;margin-bottom:6px;">⚡ ACTION REQUIRED TODAY</div>
    <div style="font-size:20px;font-weight:bold;color:${C.orange};">${dueToday.length} contact${dueToday.length!==1?"s":""} need action right now</div>
    <div style="font-size:11px;color:${C.muted};margin-top:4px;">See the full list below. Each hour of delay reduces reply probability by ~3%.</div>
  </div>` : `
  <div style="background:#001a0a;border:1px solid #005a20;border-radius:4px;padding:14px 16px;margin-bottom:20px;">
    <div style="font-size:14px;color:${C.green};font-weight:bold;">✓ No urgent actions today — all contacts are on track</div>
  </div>`}

  <!-- TOP STATS ROW -->

  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;">
    ${[
      ["Total Contacts", total,                       C.text],
      ["Converting",     converting.length,           C.green],
      ["Sample Out",     sampleOut.length,            C.orange],
      ["Avg Fit Score",  avgScore,                    C.gold],
    ].map(([l,v,c]) => `
    <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;padding:12px;text-align:center;">
      <div style="font-size:24px;font-weight:bold;color:${c};font-family:monospace;line-height:1;">${v}</div>
      <div style="font-size:9px;color:${C.dim};letter-spacing:1.5px;margin-top:4px;font-family:monospace;">${l}</div>
    </div>`).join("")}
  </div>

  <!-- CONVERSION FUNNEL -->

  <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;padding:14px 16px;margin-bottom:20px;">
    <div style="font-size:9px;color:${C.muted};letter-spacing:2px;font-family:monospace;text-transform:uppercase;margin-bottom:12px;">Conversion Funnel</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center;">
      ${[
        ["DMed",     contacted,  C.text,   ""],
        ["Replied",  gotReply,   C.purple, `${replyRate}% reply rate`],
        ["Sampled",  sampleSent, C.orange, `${sampleRate}% of replies`],
        ["Active",   converted,  C.green,  `${convRate}% of samples`],
      ].map(([l,v,c,sub]) => `
      <div>
        <div style="font-size:22px;font-weight:bold;color:${c};font-family:monospace;line-height:1;">${v}</div>
        <div style="font-size:10px;color:${C.dim};margin-top:3px;">${l}</div>
        ${sub ? `<div style="font-size:9px;color:${C.muted};margin-top:2px;font-family:monospace;">${sub}</div>` : ""}
      </div>`).join(`
      <div style="display:flex;align-items:center;color:${C.dim};font-size:18px;">→</div>
      `)}
    </div>
    ${!weekTarget10 ? `
    <div style="margin-top:12px;padding:8px 10px;background:#1a0a00;border-radius:3px;font-size:11px;color:${C.orange};">
      ⚠ Target: 10 active converters by Week 4. Currently ${converting.length}/10.
      ${converting.length === 0 ? " Focus all energy on DM outreach today." : ` Need ${10 - converting.length} more.`}
    </div>` : `
    <div style="margin-top:12px;padding:8px 10px;background:#001a0a;border-radius:3px;font-size:11px;color:${C.green};">
      ✓ Week 4 target of 10 active converters achieved. Scale to 80 DMs/day.
    </div>`}
  </div>

  <!-- PIPELINE BREAKDOWN -->

  <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;padding:14px 16px;margin-bottom:20px;">
    <div style="font-size:9px;color:${C.muted};letter-spacing:2px;font-family:monospace;text-transform:uppercase;margin-bottom:12px;">Pipeline Breakdown</div>
    ${stageBar}
  </div>

  <!-- DUE TODAY TABLE -->

${dueToday.length > 0 ? `

  <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;margin-bottom:20px;overflow:hidden;">
    <div style="padding:12px 16px;border-bottom:1px solid ${C.border};background:#1a0a00;">
      <div style="font-size:9px;color:${C.orange};letter-spacing:2px;font-family:monospace;text-transform:uppercase;">⚡ Action Required Today (${dueToday.length})</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#0f0d07;">
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">HANDLE</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">NICHE</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">ACTION</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:center;font-weight:normal;">SCORE</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">NOTES</th>
        </tr>
      </thead>
      <tbody>${dueTodayRows}</tbody>
    </table>
    ${dueToday.length > 20 ? `<div style="padding:8px 14px;font-size:11px;color:${C.muted};border-top:1px solid ${C.border};">+ ${dueToday.length - 20} more in the CRM app</div>` : ""}
  </div>` : ""}

  <!-- CONVERTING INFLUENCERS -->

${converting.length > 0 ? `

  <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;margin-bottom:20px;overflow:hidden;">
    <div style="padding:12px 16px;border-bottom:1px solid ${C.border};background:#001a0a;">
      <div style="font-size:9px;color:${C.green};letter-spacing:2px;font-family:monospace;text-transform:uppercase;">✓ Active Converters (${converting.length})</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#0f0d07;">
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">HANDLE</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">NICHE</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">LOCATION</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">FIRST POST</th>
        </tr>
      </thead>
      <tbody>${convertingRows}</tbody>
    </table>
  </div>` : ""}

  <!-- SAMPLES OUT -->

${sampleOut.length > 0 ? `

  <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;margin-bottom:20px;overflow:hidden;">
    <div style="padding:12px 16px;border-bottom:1px solid ${C.border};">
      <div style="font-size:9px;color:${C.orange};letter-spacing:2px;font-family:monospace;text-transform:uppercase;">📦 Samples In Transit / Delivered (${sampleOut.length})</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#0f0d07;">
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">HANDLE</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">NICHE</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">SHIPPED</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">STATUS</th>
        </tr>
      </thead>
      <tbody>${sampleRows}</tbody>
    </table>
  </div>` : ""}

  <!-- STALLED CONTACTS -->

${stalled.length > 0 ? `

  <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;margin-bottom:20px;overflow:hidden;">
    <div style="padding:12px 16px;border-bottom:1px solid ${C.border};background:#1a0000;">
      <div style="font-size:9px;color:${C.red};letter-spacing:2px;font-family:monospace;text-transform:uppercase;">⚠ Stalled — DM Sent, No Reply in 14+ Days (${stalled.length})</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#0f0d07;">
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">HANDLE</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">NICHE</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">LAST DM</th>
          <th style="padding:7px 10px;font-size:9px;color:${C.dim};font-family:monospace;letter-spacing:1px;text-align:left;font-weight:normal;">RECOMMENDATION</th>
        </tr>
      </thead>
      <tbody>${stalledRows}</tbody>
    </table>
  </div>` : ""}

  <!-- HIGH-VALUE UNCONTACTED -->

${uncontacted.length > 0 ? `

  <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;margin-bottom:20px;padding:14px 16px;">
    <div style="font-size:9px;color:${C.gold};letter-spacing:2px;font-family:monospace;text-transform:uppercase;margin-bottom:10px;">★ High-Fit Contacts Not Yet DMed (Score 7+)</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${uncontacted.slice(0,15).map(inf =>
        `<span style="background:${C.gold}15;border:1px solid ${C.gold}40;color:${C.gold};font-family:monospace;font-size:10px;padding:3px 8px;border-radius:2px;">${inf.handle} ${inf.tccFitScore}/10</span>`
      ).join("")}
      ${uncontacted.length > 15 ? `<span style="color:${C.muted};font-size:11px;align-self:center;">+${uncontacted.length-15} more</span>` : ""}
    </div>
  </div>` : ""}

  <!-- DAILY TARGETS -->

  <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;margin-bottom:20px;padding:14px 16px;">
    <div style="font-size:9px;color:${C.muted};letter-spacing:2px;font-family:monospace;text-transform:uppercase;margin-bottom:10px;">Daily Targets (TCC 18-Week Plan)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;">
      ${[
        ["DMs to send today",    converting.length >= 10 ? "80 (scaled)" : "40",    C.text],
        ["Active converter goal","10 by Week 4",   converting.length >= 10 ? C.green : C.orange],
        ["Reply rate target",    "8–12%",          replyRate >= 8 ? C.green : C.yellow],
        ["Sample → convert",     "20–30%",         convRate >= 20 ? C.green : C.yellow],
        ["Week 8+ DM pace",      "60 DMs/day",     C.muted],
        ["Affiliate commission", "15% per sale",   C.muted],
      ].map(([l,v,c]) => `
      <div style="display:flex;gap:8px;">
        <span style="color:${C.dim};font-family:monospace;flex:1;">${l}</span>
        <span style="color:${c};font-family:monospace;font-weight:bold;">${v}</span>
      </div>`).join("")}
    </div>
  </div>

  <!-- FOOTER -->

  <div style="border-top:1px solid ${C.border};padding-top:14px;font-size:10px;color:${C.dim};font-family:monospace;line-height:2;">
    <div>Generated: ${now.toISOString()}</div>
    <div>Contacts: ${total} · Converting: ${converting.length} · Samples out: ${sampleOut.length} · Stalled: ${stalled.length}</div>
    <div style="margin-top:6px;"><a href="https://tcc-crm.vercel.app" style="color:${C.gold};">Open CRM →</a></div>
  </div>

</div>
</body>
</html>`;

return { html, dueToday, converting, stalled, sampleOut, total };
}

async function sendEmail(html, subject) {
const RESEND_KEY   = process.env.RESEND_API_KEY;
const REPORT_EMAIL = process.env.REPORT_EMAIL;

if (!RESEND_KEY || !REPORT_EMAIL) {
console.log(“Email skipped — RESEND_API_KEY or REPORT_EMAIL not set in env vars”);
return { skipped: true };
}

const res = await fetch(“https://api.resend.com/emails”, {
method: “POST”,
headers: {
“Content-Type”: “application/json”,
“Authorization”: `Bearer ${RESEND_KEY}`
},
body: JSON.stringify({
from: “TCC CRM [onboarding@resend.dev](mailto:onboarding@resend.dev)”,
to:   [REPORT_EMAIL],
subject,
html
})
});

const data = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`);
return data;
}

// ── VERCEL HANDLER ────────────────────────────────────────────────────────
export default async function handler(req, res) {

try {
const infs = await fetchInfluencers();
const { html, dueToday, converting, stalled, total } = buildReport(infs);

```
const preview = req.query?.preview === "1" || req.method === "GET";

// Preview mode — return HTML directly in browser
if (preview) {
  res.setHeader("Content-Type", "text/html");
  res.status(200).send(html);
  return;
}

// Cron / POST mode — send email
const now     = new Date();
const dateStr = now.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
const subject = `☕ TCC Report ${dateStr} — ${dueToday.length} due · ${converting.length} converting · ${total} total`;

const emailResult = await sendEmail(html, subject);

res.status(200).json({
  ok: true,
  sent: !emailResult.skipped,
  total,
  dueToday: dueToday.length,
  converting: converting.length,
  stalled: stalled.length,
  timestamp: now.toISOString()
});
```

} catch (err) {
console.error(“Report error:”, err);
res.status(500).json({ ok: false, error: err.message });
}
}
