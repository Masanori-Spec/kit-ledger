# Product positioning and next validation

Research checked 2026-10-03 using public vendor material. The sample workshop and quantities are fictional. No university sites or customer accounts were used.

## Existing capabilities are established

- [MRPeasy's kitting documentation](https://www.mrpeasy.com/demo-videos/kitting/) describes BOM-backed kits, auto-assembly and phantom assemblies tied to manufacturing orders. Its [BOM product page](https://www.mrpeasy.com/bill-of-materials-bom-software/) also covers availability, production and procurement workflows.
- [Craftybase's getting-started guide](https://craftybase-assets.s3.us-east-1.amazonaws.com/site/docs/getting_started_with_craftybase_v2.pdf) describes recipes and material usage for manufacturing batches.
- [Warehance's kitting feature](https://www.warehance.com/features/kitting) describes reusable recipes, component availability, staging/picking and inventory changes connected to assembly tasks.

BOMs, kitting, stock feasibility and picking are not new ideas. This project does not claim algorithmic novelty, a patentable invention, market uniqueness or superiority over those products. The source pages establish overlapping capabilities; they are not a comprehensive competitive feature audit, nor proof that competitors lack a particular optimization option.

## The narrow hypothesis

An occasional workshop organizer may benefit from a lightweight workflow:

1. Receive or count a small stock snapshot
2. Compare a total-kit objective with an explicit recipe-priority objective
3. Inspect the exact allocation, full-target shortages and conservation arithmetic
4. Print batch pick sheets, without opening an account or writing to an inventory system

The differentiation is an intentionally small **snapshot-to-print workflow**, with a visible exact-search limit, transparent tie-break rules and a shared CLI/browser engine. It is a portfolio demonstration of careful specification, deterministic optimization, failure handling and test design. Whether this workflow saves real users time remains unvalidated.

## Suggested validation before investing further

Recruit a small number of workshop organizers with explicit permission. Ask them to prepare one real batch using their current method, then try this tool with a redacted snapshot. Measure preparation time, corrections to the input, misunderstandings of reservations/shortages, and picking errors. Compare the resulting pick sheet with what they actually take to the workbench. Do not treat a positive demo reaction as willingness to pay.

Potential improvements should follow those observations: a spreadsheet-friendly editor or import, a more useful printed check-off layout, or a clearer recipe-priority editor. Increasing the solver scope or adding live inventory integrations would introduce a different product and risk profile.

No interviews, customer outreach, purchases, pricing tests or demand validation have been performed for this release.
