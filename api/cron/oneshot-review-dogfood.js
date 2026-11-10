// TEMPORARY one-shot (Nov 8, 2026) — Review Engine dogfood runner.
// Executes, in-process through the production engine: (phase=config)
// the client-zero TechCare config upsert + read-back + a dry-run
// wording proof; (phase=selftest) one real ask to the owner's own
// cell; (phase=dogfood) the two approved dogfood asks ONLY — Diane
// (WGB-4) and Lorese Morgan (WGB-9). Token-gated. Deleted in the
// cleanup commit immediately after the run completes.
const engine = require("../_reviewEngine");

const TOKEN = "f8ced648eacb184d13878d6088406b6d";

const CONFIG = {
  client_key: "techcare",
  business_name: "TechCare by WilGlobo",
  review_link: "https://g.page/r/CZ8G2uJ0q4R6EBM/review",
  owner_name: "Wilton",
  owner_mobile: "+18259626061",
  owner_email: "wilton@wilglobo.com",
  from_number: "",
  timezone: "America/Edmonton",
  services: ["computer help at home", "email and account setup", "phone and tablet help", "scam-safety check"],
  city: "Calgary",
  review_highlight: true,
  active: true,
};

const SELFTEST = { client_key: "techcare", job_ref: "SELFTEST-20261108", customer_name: "Wilton", customer_mobile: "+18259626061" };
const DOGFOOD = [
  { client_key: "techcare", job_ref: "WGB-4", customer_name: "Diane", customer_mobile: "+14034003731" },
  { client_key: "techcare", job_ref: "WGB-9", customer_name: "Lorese Morgan", customer_mobile: "+14033835046" },
];

module.exports = async (req, res) => {
  const q = req.query || {};
  if (q.t !== TOKEN) return res.status(404).json({ error: "not found" });
  const phase = String(q.phase || "");
  try {
    if (phase === "config") {
      const up = await engine.upsertConfig(CONFIG);
      const back = await engine.getConfigByKey("techcare");
      let dry = null;
      if (back) {
        const d = await engine.handleJobCompleted(
          { client_key: "techcare", job_ref: "DRYRUN-WORDING", customer_name: "Wilton", customer_mobile: "+18259626061" },
          { dryRun: true }
        );
        dry = d && d.steps ? d.steps.ask : d;
      }
      return res.status(200).json({
        ok: true, phase,
        upsert: { ok: up.ok, stored: up.stored || null, error: up.error || null },
        readback: back,
        dry_run: dry,
      });
    }
    if (phase === "selftest") {
      const out = await engine.handleJobCompleted(SELFTEST, {});
      const ask = await engine.getAsk("techcare:SELFTEST-20261108");
      return res.status(200).json({ ok: true, phase, result: out, ask_row: ask });
    }
    if (phase === "dogfood") {
      const results = [];
      for (const job of DOGFOOD) {
        const out = await engine.handleJobCompleted(job, {});
        results.push({ job_ref: job.job_ref, result: out });
      }
      const asks = await engine.listAsks("techcare", 50);
      return res.status(200).json({ ok: true, phase, results, asks });
    }
    return res.status(400).json({ ok: false, error: "specify phase=config|selftest|dogfood" });
  } catch (e) {
    return res.status(500).json({ ok: false, phase, error: String(e && e.message ? e.message : e) });
  }
};
